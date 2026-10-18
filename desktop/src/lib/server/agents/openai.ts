import 'server-only';
import { runCli, type Driver } from './driver';
import { runTool, TOOL_SPECS } from './repo-tools';

/** OpenAI-style chat message, as sent to /chat/completions. */
type Msg =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface Chunk {
  choices?: {
    delta?: {
      content?: string | null;
      tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
    };
    finish_reason?: string | null;
  }[];
  error?: { message?: string };
}

const MAX_ROUNDS = 30;

/**
 * Any OpenAI-compatible chat completions API: OpenAI, OpenRouter, Groq, Together, Azure,
 * Ollama, LM Studio, vLLM… The conversation is kept by PR Lens, and the model gets repository inspection and editing
 * repo tools that run here.
 */
export const openai: Driver = async ({ agent, cwd, system, prompt, history, hooks, signal, workflow, coordinator }) => {
  const messages: Msg[] = [
    { role: 'system', content: `${system}\nUse the tools to read the code; you can't see it otherwise.` },
    ...history.map((t): Msg => (t.role === 'user' ? { role: 'user', content: t.text } : { role: 'assistant', content: t.text })),
    { role: 'user', content: prompt },
  ];
  let wrote = false;

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const res = await fetch(`${agent.baseUrl}/chat/completions`, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          ...(agent.apiKey ? { Authorization: `Bearer ${agent.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: agent.model,
          messages,
          tools: coordinator
            ? undefined
            : workflow
              ? [
                  ...TOOL_SPECS,
                  {
                    type: 'function',
                    function: {
                      name: 'workflow_shell',
                      description: 'Run a command in the ticket checkout for implementation, tests, or Git operations.',
                      parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'], additionalProperties: false },
                    },
                  },
                ]
              : TOOL_SPECS,
          ...(workflow?.reasoningEffort ? { reasoning_effort: workflow.reasoningEffort } : {}),
          stream: true,
        }),
      });
      if (!res.ok || !res.body) {
        const body = await res.text().catch(() => '');
        let detail = body.slice(0, 300);
        try {
          detail = (JSON.parse(body) as Chunk).error?.message ?? detail;
        } catch {
          /* not JSON */
        }
        hooks.error(`${agent.name}: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`);
        return;
      }

      let text = '';
      const calls: ToolCall[] = [];
      let startedText = false;
      for await (const data of sse(res.body)) {
        if (data === '[DONE]') break;
        let chunk: Chunk;
        try {
          chunk = JSON.parse(data) as Chunk;
        } catch {
          continue;
        }
        if (chunk.error) {
          hooks.error(chunk.error.message ?? 'The provider returned an error.');
          return;
        }
        const delta = chunk.choices?.[0]?.delta;
        if (delta?.content) {
          if (!startedText && wrote) hooks.text('\n\n');
          startedText = wrote = true;
          text += delta.content;
          hooks.text(delta.content);
        }
        for (const tc of delta?.tool_calls ?? []) {
          const c = (calls[tc.index] ??= { id: '', type: 'function', function: { name: '', arguments: '' } });
          if (tc.id) c.id = tc.id;
          if (tc.function?.name) c.function.name += tc.function.name;
          if (tc.function?.arguments) c.function.arguments += tc.function.arguments;
        }
      }

      const used = calls.filter(Boolean);
      if (coordinator && used.length) {
        hooks.error('Coordinator attempted to use tools.');
        return;
      }
      if (!used.length) return;
      messages.push({ role: 'assistant', content: text || null, tool_calls: used });
      for (const c of used) {
        const { detail, output } =
          workflow && c.function.name === 'workflow_shell'
            ? await (async () => {
                const { command } = JSON.parse(c.function.arguments);
                if (typeof command !== 'string' || command.length > 20000) throw new Error('Invalid command.');
                let output = '';
                const result = await runCli(
                  process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
                  process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-c', command],
                  {
                    cwd,
                    stdin: '',
                    signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]),
                    processGroup: true,
                    onLine: (line) => {
                      output = (output + line + '\n').slice(-60000);
                    },
                  },
                );
                return {
                  detail: command,
                  output: `Exit: ${result.code}; stopped: ${result.stopped}\n${output}\n${result.stderr}\n${result.spawnError?.message || ''}`,
                };
              })()
            : await runTool(cwd, c.function.name, c.function.arguments);
        hooks.tool({ name: c.function.name, detail });
        messages.push({ role: 'tool', tool_call_id: c.id, content: output });
      }
    }
    hooks.error(`Stopped after ${MAX_ROUNDS} rounds of tool calls.`);
  } catch (e) {
    if (signal.aborted) hooks.error('Stopped.');
    else hooks.error(`Couldn't reach ${agent.baseUrl}: ${(e as Error).message}`);
  }
};

/** The data lines of a server-sent event stream. */
async function* sse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
  if (buf.startsWith('data:')) yield buf.slice(5).trim();
}
