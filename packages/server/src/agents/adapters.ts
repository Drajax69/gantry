import fs from 'node:fs/promises';
import { run } from '../util/exec.js';
import { unavailableCapabilities, type AgentCapabilities } from '@gantry/shared';
import type { AgentAdapter, AgentStartContext, SpawnSpec } from './types.js';

/**
 * Built-in adapters. Each one exposes exactly what it can do; capabilities it
 * lacks are reported as such rather than approximated.
 */

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

const BUNDLED_CODEX = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';

export class CodexAdapter implements AgentAdapter {
  readonly id = 'codex';
  readonly label = 'Codex CLI';
  readonly promptNotes = '';

  async resolveBinary(override?: string): Promise<{ path: string | null; via: string | null }> {
    if (override) return { path: (await exists(override)) ? override : null, via: override ? 'config' : null };
    if (process.env.GANTRY_CODEX_BINARY) {
      const path = process.env.GANTRY_CODEX_BINARY;
      return (await exists(path)) ? { path, via: 'GANTRY_CODEX_BINARY' } : { path: null, via: 'GANTRY_CODEX_BINARY' };
    }
    if (await exists(BUNDLED_CODEX)) return { path: BUNDLED_CODEX, via: 'ChatGPT.app bundle' };
    for (const dir of (process.env.PATH ?? '').split(':')) {
      const candidate = `${dir}/codex`;
      if (await exists(candidate)) return { path: candidate, via: 'PATH' };
    }
    return { path: null, via: null };
  }

  async capabilities(binaryPath: string | null): Promise<AgentCapabilities> {
    if (!binaryPath) {
      return unavailableCapabilities(this.id, this.label, [
        'Install the Codex CLI (bundled with the ChatGPT desktop app) or set agents.codex.binary in gantry.yaml.',
      ]);
    }
    let version: string | null = null;
    try {
      version = (await run(binaryPath, ['--version'], { timeoutMs: 10_000 })) || null;
    } catch {
      /* version reporting is best-effort */
    }
    return {
      id: this.id,
      label: this.label,
      available: true,
      discoveredVia: binaryPath,
      version,
      resumeMode: 'deeplink',
      takeover: true,
      interruptMode: 'process-group',
      deepLinkScheme: 'codex://threads',
      streaming: true,
      notes: ['Background runs stream JSON events; "Take over" interrupts the run and opens the same thread in the Codex app.'],
    };
  }

  buildStart(context: AgentStartContext): SpawnSpec {
    const argv = [
      context.binary,
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--approve-for-me',
      '-C',
      context.workspace,
      ...context.addDirs.flatMap((dir) => ['--add-dir', dir]),
    ];
    for (const [key, value] of Object.entries(context.args)) {
      argv.push(`--${key}`, value);
    }
    argv.push(context.prompt);
    return { argv, cwd: context.workspace, claim: `codex exec` };
  }

  buildResume(sessionId: string, context: AgentStartContext): SpawnSpec | null {
    return {
      argv: [context.binary, 'exec', 'resume', sessionId],
      cwd: context.workspace,
      claim: 'codex exec resume',
    };
  }

  deepLink(sessionId: string): string | null {
    return `codex://threads/${sessionId}`;
  }

  parseSessionLine(line: string): string | null {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      const threadId = event.thread_id ?? event.threadId ?? (event.thread as { id?: string } | undefined)?.id ?? event.session_id ?? event.sessionId;
      return typeof threadId === 'string' && threadId ? threadId : null;
    } catch {
      return null;
    }
  }
}

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly id = 'claude';
  readonly label = 'Claude Code';
  readonly promptNotes = 'Work autonomously toward the ticket goal; avoid interactive questions.';

  async resolveBinary(override?: string): Promise<{ path: string | null; via: string | null }> {
    if (override) return { path: (await exists(override)) ? override : null, via: override ? 'config' : null };
    for (const dir of (process.env.PATH ?? '').split(':')) {
      const candidate = `${dir}/claude`;
      if (await exists(candidate)) return { path: candidate, via: 'PATH' };
    }
    return { path: null, via: null };
  }

  async capabilities(binaryPath: string | null): Promise<AgentCapabilities> {
    if (!binaryPath) {
      return unavailableCapabilities(this.id, this.label, ['Install Claude Code (npm i -g @anthropic-ai/claude-code) or set agents.claude.binary in gantry.yaml.']);
    }
    let version: string | null = null;
    try {
      version = (await run(binaryPath, ['--version'], { timeoutMs: 10_000 })) || null;
    } catch {
      /* best-effort */
    }
    return {
      id: this.id,
      label: this.label,
      available: true,
      discoveredVia: binaryPath,
      version,
      resumeMode: 'terminal',
      takeover: true,
      interruptMode: 'process-group',
      deepLinkScheme: null,
      streaming: true,
      notes: ['No native app deep link: "Open session" attaches a terminal running `claude --resume <session>`.', 'Take over interrupts the background run in the shared session, then opens the terminal.'],
    };
  }

  buildStart(context: AgentStartContext): SpawnSpec {
    const argv = [
      context.binary,
      '-p',
      context.prompt,
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      context.args['permissionMode'] ?? 'acceptEdits',
      ...context.addDirs.flatMap((dir) => ['--add-dir', dir]),
    ];
    return { argv, cwd: context.workspace, claim: 'claude -p' };
  }

  buildResume(sessionId: string, context: AgentStartContext): SpawnSpec | null {
    return { argv: [context.binary, '--resume', sessionId], cwd: context.workspace, claim: 'claude --resume' };
  }

  deepLink(): string | null {
    return null;
  }

  parseSessionLine(line: string): string | null {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event.type === 'system' || event.session_id || event.sessionId) {
        const sessionId = event.session_id ?? event.sessionId;
        return typeof sessionId === 'string' && sessionId ? sessionId : null;
      }
      return null;
    } catch {
      return null;
    }
  }
}

const OPENCODE_SESSION_RE = /\b(ses_[A-Za-z0-9]+)\b/;

export class OpenCodeAdapter implements AgentAdapter {
  readonly id = 'opencode';
  readonly label = 'OpenCode';
  readonly promptNotes = '';

  async resolveBinary(override?: string): Promise<{ path: string | null; via: string | null }> {
    if (override) return { path: (await exists(override)) ? override : null, via: override ? 'config' : null };
    for (const dir of (process.env.PATH ?? '').split(':')) {
      const candidate = `${dir}/opencode`;
      if (await exists(candidate)) return { path: candidate, via: 'PATH' };
    }
    return { path: null, via: null };
  }

  async capabilities(binaryPath: string | null): Promise<AgentCapabilities> {
    if (!binaryPath) {
      return unavailableCapabilities(this.id, this.label, ['Install OpenCode (see opencode.ai) or set agents.opencode.binary in gantry.yaml.']);
    }
    let version: string | null = null;
    try {
      version = (await run(binaryPath, ['--version'], { timeoutMs: 10_000 })) || null;
    } catch {
      /* best-effort */
    }
    return {
      id: this.id,
      label: this.label,
      available: true,
      discoveredVia: binaryPath,
      version,
      resumeMode: 'terminal',
      takeover: true,
      interruptMode: 'process-group',
      deepLinkScheme: null,
      streaming: false,
      notes: ['Best-effort adapter: session ids are parsed from run output when OpenCode prints them.'],
    };
  }

  buildStart(context: AgentStartContext): SpawnSpec {
    return { argv: [context.binary, 'run', context.prompt], cwd: context.workspace, claim: 'opencode run' };
  }

  buildResume(sessionId: string, context: AgentStartContext): SpawnSpec | null {
    return { argv: [context.binary, '--session', sessionId, 'run', 'Continue the previous task.'], cwd: context.workspace, claim: 'opencode --session' };
  }

  deepLink(): string | null {
    return null;
  }

  parseSessionLine(line: string): string | null {
    return OPENCODE_SESSION_RE.exec(line)?.[1] ?? null;
  }
}

/**
 * Generic adapter: runs a user-supplied command template. `${prompt}` is the
 * rendered prompt and `${workspace}` the workspace; the command runs as an
 * argv array (never a shell string). It has no session concept, so resume is
 * unsupported — reported honestly — while takeover still works because the
 * process group is Gantry-owned.
 */
export class GenericAdapter implements AgentAdapter {
  readonly id = 'generic';
  readonly label = 'Custom command';
  readonly promptNotes = '';

  async resolveBinary(): Promise<{ path: string | null; via: string | null }> {
    // The adapter's capability is its configured command, not a binary.
    return { path: 'configured-command', via: 'agents.generic.args.command' };
  }

  async capabilities(): Promise<AgentCapabilities> {
    return {
      ...unavailableCapabilities(this.id, this.label, [
        'The generic adapter runs a configured command (agents.generic.args.command) with the ticket prompt. It cannot report sessions, so resume is unavailable.',
      ]),
      available: true,
      discoveredVia: 'config',
      resumeMode: 'unsupported',
      takeover: true,
      interruptMode: 'process-group',
    };
  }

  buildStart(context: AgentStartContext): SpawnSpec {
    const command = context.args['command'];
    if (!command) throw new Error('The generic agent needs agents.generic.args.command in gantry.yaml (use ${prompt} for the rendered prompt).');
    // Split on whitespace, then substitute as single argv tokens: the prompt
    // travels as one argument even though the template is written inline.
    const argv = command.split(' ').map((part) => part.replace('${prompt}', context.prompt).replace('${workspace}', context.workspace));
    return { argv, cwd: context.workspace, claim: `${String(argv[0])} ${String(argv[1] ?? '')}`.trim() };
  }

  buildResume(): SpawnSpec | null {
    return null;
  }

  deepLink(): string | null {
    return null;
  }

  parseSessionLine(): string | null {
    return null;
  }
}
