import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFile, spawn as nativeSpawn } from 'node:child_process';

const crossSpawn = createRequire(import.meta.url)('cross-spawn') as {
  (...args: Parameters<typeof nativeSpawn>): ReturnType<typeof nativeSpawn>;
  _parse(bin: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv }): { command: string; args: string[]; options: { windowsVerbatimArguments?: boolean } };
};

/**
 * Process execution helpers. Argument-array execution everywhere except where
 * a configured value is explicitly declared shell-mode; shell-mode commands
 * from configuration are displayed in the UI before first execution.
 */

export interface RunOptions {
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
  maxBuffer?: number;
  /** Provide stdin content to the child. */
  input?: string;
  signal?: AbortSignal;
}

export class ExecError extends Error {
  readonly code: number | null;
  readonly stderr: string;
  readonly command: string;
  constructor(command: string, args: string[], code: number | null, stderr: string, message?: string) {
    super(message ?? `${command} ${args.join(' ')} failed${code ? ` (exit ${code})` : ''}${stderr.trim() ? `: ${stderr.trim().split('\n')[0]?.slice(0, 400) ?? ''}` : ''}`);
    this.name = 'ExecError';
    this.code = code;
    this.stderr = stderr;
    this.command = `${command} ${args.join(' ')}`;
  }
}

const childEnv = (extra?: Record<string, string | undefined>): NodeJS.ProcessEnv => ({
  ...process.env,
  // Embedded Electron service: child JS runtimes must run as Node, not open another app.
  ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
  // Never let git hang on credential prompts; Gantry only uses the user's
  // existing local authentication (SSH agent / credential helper).
  GIT_TERMINAL_PROMPT: '0',
  GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=10',
  ...extra,
});

export function shellCommand(command: string, platform: NodeJS.Platform = process.platform): [string, string[]] {
  return platform === 'win32'
    ? [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command]]
    : ['sh', ['-c', command]];
}

export async function run(bin: string, args: string[], options: RunOptions = {}): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const parsed = crossSpawn._parse(bin, args, { cwd: options.cwd, env: childEnv(options.env) });
    const child = execFile(
      parsed.command,
      parsed.args,
      {
        ...parsed.options,
        cwd: options.cwd,
        encoding: 'utf8',
        timeout: options.timeoutMs ?? 30_000,
        maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
        env: childEnv(options.env),
        killSignal: 'SIGKILL',
      },
      (error, stdout, stderr) => {
        if (error) {
          const code = typeof error.code === 'number' ? error.code : null;
          reject(new ExecError(bin, args, code, String(stderr ?? ''), error.message));
        } else {
          resolve(stdout);
        }
      },
    );
    if (options.input !== undefined) child.stdin?.end(options.input);
    options.signal?.addEventListener('abort', () => child.kill('SIGKILL'), { once: true });
  }).then((stdout) => stdout.trim());
}

export interface SpawnHandle {
  pid: number;
  /** Process group id — equals pid because children are spawned detached. */
  pgid: number;
  exited: Promise<number>;
  /** Unique Windows wrapper marker used to verify ownership after restart. */
  claim?: string;
}

/**
 * Spawn a detached child: on POSIX it becomes its own process-group leader, so
 * teardown can signal the entire subtree (node services, vite workers, python
 * children) instead of only the direct child.
 */
export function spawnDetached(
  bin: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; stdio?: 'ignore' | ['ignore', number, number]; onStdout?: (chunk: Buffer) => void; onStderr?: (chunk: Buffer) => void } = {},
): SpawnHandle {
  const claim = process.platform === 'win32' ? `gantry-process-${randomUUID()}` : undefined;
  const child = crossSpawn(claim ? process.execPath : bin, claim
    ? [fileURLToPath(new URL('../../runners/command-runner.cjs', import.meta.url)), claim, bin, ...args]
    : args, {
    cwd: options.cwd,
    env: childEnv(options.env) as NodeJS.ProcessEnv,
    detached: true,
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
  });
  const exited = new Promise<number>((resolve) => {
    child.once('close', (code) => resolve(code ?? -1));
    child.once('error', () => resolve(-1));
  });
  if (Array.isArray(options.stdio) === false && options.stdio !== 'ignore') {
    child.stdout?.on('data', (chunk: Buffer) => options.onStdout?.(chunk));
    child.stderr?.on('data', (chunk: Buffer) => options.onStderr?.(chunk));
  }
  return { pid: child.pid ?? -1, pgid: child.pid ?? -1, exited, claim };
}

/** Signal a whole process group. Falls back to the single pid on failure. */
export async function signalGroup(pgid: number, signal: NodeJS.Signals, fallbackPid?: number): Promise<void> {
  if (process.platform === 'win32') {
    if (!Number.isInteger(pgid) || pgid < 2) return;
    try {
      await run('taskkill.exe', ['/PID', String(pgid), '/T', ...(signal === 'SIGKILL' ? ['/F'] : [])]);
    } catch (error) {
      // Console processes may reject a non-forced close. The caller rechecks
      // ownership before escalating; a failed forced termination is reported.
      if (signal === 'SIGKILL') throw error;
    }
    return;
  }
  try {
    process.kill(-pgid, signal);
  } catch {
    if (fallbackPid) {
      try {
        process.kill(fallbackPid, signal);
      } catch {
        /* already gone */
      }
    }
  }
}
