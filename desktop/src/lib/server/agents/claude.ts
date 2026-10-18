import 'server-only';
import { CLI } from './store';
import { cliOutcome, runCli, toolDetail, transcript, type Driver } from './driver';

/** The parts of `claude -p --output-format stream-json` lines we read. */
interface StreamLine {
  type?: string;
  subtype?: string;
  session_id?: string;
  event?: {
    type?: string;
    content_block?: { type?: string };
    delta?: { type?: string; text?: string };
  };
  message?: { content?: { type: string; name?: string; input?: Record<string, unknown> }[] };
  result?: unknown;
  total_cost_usd?: number;
  is_error?: boolean;
}

const ALLOWED_TOOLS = [
  'Read',
  'Grep',
  'Glob',
  'Edit',
  'Write',
  'Bash(git diff:*)',
  'Bash(git log:*)',
  'Bash(git show:*)',
  'Bash(git blame:*)',
  'Bash(git grep:*)',
  'Bash(ls:*)',
  'Bash(wc:*)',
].join(',');

export const claude: Driver = async ({ agent, cwd, system, prompt, sessionId, history, hooks, signal, workflow, coordinator }) => {
  // The checkout is untrusted code under review, so lock the child down: --restricted ignores
  // user/project/local settings (no repo hooks or allow rules, none of your pre-approved
  // tools), --strict-mcp-config with no config loads no MCP servers, and dontAsk denies
  // anything outside the file-editing and inspection allowlist instead of prompting.
  const args = coordinator
    ? [
        '-p',
        '--output-format',
        'stream-json',
        '--verbose',
        '--include-partial-messages',
        '--restricted',
        '--strict-mcp-config',
        '--tools',
        '',
        '--permission-mode',
        'dontAsk',
        '--append-system-prompt',
        system,
      ]
    : workflow
      ? [
          '-p',
          '--output-format',
          'stream-json',
          '--verbose',
          '--include-partial-messages',
          '--dangerously-skip-permissions',
          '--append-system-prompt',
          system,
          ...workflow.addDirs.flatMap((dir) => ['--add-dir', dir]),
        ]
      : [
          '-p',
          '--output-format',
          'stream-json',
          '--verbose',
          '--include-partial-messages',
          '--restricted',
          '--tools',
          'Read,Grep,Glob,Edit,Write,Bash',
          '--strict-mcp-config',
          '--permission-mode',
          'dontAsk',
          '--allowedTools',
          ALLOWED_TOOLS,
          '--append-system-prompt',
          system,
        ];
  if (workflow?.reasoningEffort) args.push('--effort', workflow.reasoningEffort === 'xhigh' ? 'high' : workflow.reasoningEffort);
  if (agent.model) args.push('--model', agent.model);
  if (sessionId) args.push('--resume', sessionId);

  let sawText = false;
  let wrote = false;
  let failed = false;
  const r = await runCli(CLI.claude, args, {
    cwd,
    signal,
    processGroup: !!workflow || !!coordinator,
    stdin: sessionId ? prompt : transcript(history) + prompt,
    onLine(line) {
      let ev: StreamLine;
      try {
        ev = JSON.parse(line) as StreamLine;
      } catch {
        return;
      }
      if (ev.session_id) hooks.session(ev.session_id);
      if (ev.type === 'stream_event') {
        const e = ev.event;
        if (e?.type === 'content_block_start' && e.content_block?.type === 'text' && sawText) hooks.text('\n\n');
        if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
          sawText = wrote = true;
          hooks.text(e.delta.text ?? '');
        }
      } else if (ev.type === 'assistant') {
        for (const block of ev.message?.content ?? []) {
          if (block.type === 'tool_use') hooks.tool({ name: block.name ?? 'tool', detail: toolDetail(block.input) });
        }
      } else if (ev.type === 'result') {
        if (typeof ev.total_cost_usd === 'number') hooks.cost(ev.total_cost_usd);
        if (!wrote && typeof ev.result === 'string') hooks.text(ev.result);
        if (ev.is_error) {
          failed = true;
          hooks.error(typeof ev.result === 'string' ? ev.result : `Claude stopped (${ev.subtype})`);
        }
      }
    },
  });
  cliOutcome('Claude Code', CLI.claude, r, hooks, failed);
};
