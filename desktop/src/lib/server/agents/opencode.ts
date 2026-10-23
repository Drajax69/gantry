import 'server-only';
import path from 'node:path';
import { CLI } from './store';
import { cliOutcome, runCli, toolDetail, transcript, type Driver } from './driver';
import { resolveOpenCodeModel } from './opencode-models';
import { scopedSessionId } from './session-scope';

/** The parts of `opencode run --format json` lines we read. */
interface OpenCodeLine {
  type?: string;
  sessionID?: string;
  error?: { name?: string; data?: { message?: string } };
  part?: {
    text?: string;
    tool?: string;
    cost?: number;
    state?: { status?: string; input?: Record<string, unknown>; error?: string };
  };
}

// Inspection commands a review chat may run; everything else in the shell is refused.
const REVIEW_SHELL = ['git diff', 'git log', 'git show', 'git blame', 'git grep', 'ls', 'wc'];

/**
 * Permissions for one run, passed as inline config so they sit above your own OpenCode config.
 * The catch-all deny also refuses MCP tools and anything else not listed.
 */
function permission(mode: 'review' | 'coordinator' | 'workflow', directories: string[]) {
  if (mode === 'workflow') return {
    external_directory: Object.fromEntries(directories.map((dir) => [`${path.resolve(dir).replaceAll('\\', '/').replace(/\/$/, '')}/*`, 'allow'])),
  };
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

export const opencode: Driver = async ({ agent, cwd, system, prompt, sessionId: previousSession, sessionDirectory, history, hooks, signal, workflow, coordinator }) => {
  const sessionId = scopedSessionId('opencode', previousSession, sessionDirectory, cwd);
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
  // OpenCode also resolves its project from PWD. An Electron process can inherit
  // Gantry's launch directory even when spawn's cwd is the review checkout.
  const args = ['run', '--format', 'json', '--dir', cwd, '--print-logs', '--log-level', 'INFO'];
  // A workflow stage works unattended, like Claude's --dangerously-skip-permissions; your OpenCode deny rules still hold.
  if (mode === 'workflow') args.push('--auto');
  // OpenCode calls reasoning effort a model variant; Gantry's top level, ultra, runs as max.
  if (workflow?.reasoningEffort) args.push('--variant', workflow.reasoningEffort === 'ultra' ? 'max' : workflow.reasoningEffort);
  if (model) args.push('--model', model);
  if (sessionId) args.push('--session', sessionId);
  // OpenCode has no flag for extra system instructions, so each message carries them, as with Codex.
  const stdin = sessionId ? `${system}\n\n${prompt}` : `${system}\n\n${transcript(history)}${prompt}`;
  const rules = permission(mode, [cwd, ...(workflow?.workspace ? [workflow.workspace] : []), ...(workflow?.addDirs ?? [])]);
  const blocked = new AbortController();

  let wrote = false;
  let failed = false;
  let cost = 0;
  let reported = false;
  const r = await runCli(CLI.opencode, args, {
    cwd,
    signal: AbortSignal.any([signal, blocked.signal]),
    processGroup: !!workflow || !!coordinator,
    stdin,
    env: { PWD: cwd, ...(rules ? { OPENCODE_CONFIG_CONTENT: JSON.stringify({ permission: rules }) } : {}) },
    // OpenCode 1.19 emits permission waits to its logger, not JSON stdout.
    // Stop an unattended wait so the executor records a visible waiting/error state.
    onStderrLine(line) {
      if (!/\bmessage=asking\b/.test(line) || !/\bpermission=/.test(line) || blocked.signal.aborted) return;
      const permission = /\bpermission=(\S+)/.exec(line)?.[1] ?? 'unknown';
      failed = true;
      diagnosticHooks.error(`OpenCode is blocked awaiting ${permission} permission. Check the stage's workspace access or OpenCode permission rules, then retry. Request: ${line.slice(-2000)}`);
      blocked.abort();
    },
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
        const state = ev.part.state;
        const detail = [toolDetail(state?.input), state?.status === 'error' ? `Failed: ${state.error || 'Tool call failed'}` : ''].filter(Boolean).join(' · ');
        hooks.tool({ name: ev.part.tool, detail });
      } else if (ev.type === 'step_finish' && typeof ev.part?.cost === 'number') {
        cost += ev.part.cost;
        if (cost > 0) hooks.cost(cost);
      } else if (ev.type === 'error') {
        failed = true;
        diagnosticHooks.error(ev.error?.data?.message || ev.error?.name || 'OpenCode stopped.');
      }
    },
  });
  if (!blocked.signal.aborted) cliOutcome('OpenCode', CLI.opencode, r, diagnosticHooks, failed);
  if (!blocked.signal.aborted && !failed && !r.stopped && r.code === 0 && !wrote) {
    diagnosticHooks.error('OpenCode exited without returning an answer. Its session output may not have reached Gantry; retry the stage or chat.');
  }
};
