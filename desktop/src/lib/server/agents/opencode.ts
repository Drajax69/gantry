import 'server-only';
import { CLI } from './store';
import { cliOutcome, runCli, toolDetail, transcript, type Driver } from './driver';
import { resolveOpenCodeModel } from './opencode-models';

/** The parts of `opencode run --format json` lines we read. */
interface OpenCodeLine {
  type?: string;
  sessionID?: string;
  error?: { name?: string; data?: { message?: string } };
  part?: {
    text?: string;
    tool?: string;
    cost?: number;
    state?: { status?: string; input?: Record<string, unknown> };
  };
}

// Inspection commands a review chat may run; everything else in the shell is refused.
const REVIEW_SHELL = ['git diff', 'git log', 'git show', 'git blame', 'git grep', 'ls', 'wc'];

/**
 * Permissions for one run, passed as inline config so they sit above your own OpenCode config.
 * The catch-all deny also refuses MCP tools and anything else not listed.
 */
function permission(mode: 'review' | 'coordinator' | 'workflow') {
  if (mode === 'workflow') return undefined;
  if (mode === 'coordinator') return { '*': 'deny' };
  return {
    '*': 'deny',
    read: 'allow',
    grep: 'allow',
    glob: 'allow',
    list: 'allow',
    edit: 'allow',
    bash: Object.fromEntries([['*', 'deny'], ...REVIEW_SHELL.flatMap((c) => [[c, 'allow'], [`${c} *`, 'allow']])]),
  };
}

export const opencode: Driver = async ({ agent, cwd, system, prompt, sessionId, history, hooks, signal, workflow, coordinator }) => {
  let model: string;
  try {
    model = await resolveOpenCodeModel(agent.model || '', cwd);
  } catch (error) {
    hooks.error((error as Error).message);
    return;
  }
  if (signal.aborted) { hooks.error('Stopped.'); return; }
  let currentSession = sessionId;
  const diagnosticHooks = { ...hooks, error(message: string) {
    const detail = `OpenCode · model ${model || 'provider default'}${currentSession ? ` · session ${currentSession}` : ''}: ${message}`;
    console.error(`[Gantry agent] ${detail}`);
    hooks.error(`${detail} OpenCode logs: ~/.local/share/opencode/log (or $XDG_DATA_HOME/opencode/log).`);
  } };
  const mode = coordinator ? 'coordinator' : workflow ? 'workflow' : 'review';
  const args = ['run', '--format', 'json'];
  // A workflow stage works unattended, like Claude's --dangerously-skip-permissions; your OpenCode deny rules still hold.
  if (mode === 'workflow') args.push('--auto');
  // OpenCode calls reasoning effort a model variant; Gantry's top level, ultra, runs as max.
  if (workflow?.reasoningEffort) args.push('--variant', workflow.reasoningEffort === 'ultra' ? 'max' : workflow.reasoningEffort);
  if (model) args.push('--model', model);
  if (sessionId) args.push('--session', sessionId);
  // OpenCode has no flag for extra system instructions, so each message carries them, as with Codex.
  const stdin = sessionId ? `${system}\n\n${prompt}` : `${system}\n\n${transcript(history)}${prompt}`;
  const rules = permission(mode);

  let wrote = false;
  let failed = false;
  let cost = 0;
  let reported = false;
  const r = await runCli(CLI.opencode, args, {
    cwd,
    signal,
    processGroup: !!workflow || !!coordinator,
    stdin,
    env: rules ? { OPENCODE_CONFIG_CONTENT: JSON.stringify({ permission: rules }) } : undefined,
    onLine(line) {
      let ev: OpenCodeLine;
      try {
        ev = JSON.parse(line) as OpenCodeLine;
      } catch {
        return;
      }
      if (ev.sessionID && !reported) {
        currentSession = ev.sessionID;
        reported = true;
        hooks.session(ev.sessionID);
      }
      if (ev.type === 'text' && ev.part?.text) {
        hooks.text((wrote ? '\n\n' : '') + ev.part.text);
        wrote = true;
      } else if (ev.type === 'tool_use' && ev.part?.tool) {
        hooks.tool({ name: ev.part.tool, detail: toolDetail(ev.part.state?.input) });
      } else if (ev.type === 'step_finish' && typeof ev.part?.cost === 'number') {
        cost += ev.part.cost;
        if (cost > 0) hooks.cost(cost);
      } else if (ev.type === 'error') {
        failed = true;
        diagnosticHooks.error(ev.error?.data?.message || ev.error?.name || 'OpenCode stopped.');
      }
    },
  });
  cliOutcome('OpenCode', CLI.opencode, r, diagnosticHooks, failed);
};
