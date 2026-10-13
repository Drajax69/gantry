import { execFile, spawn } from 'node:child_process';

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
  // Never let git hang on credential prompts; Gantry only uses the user's
  // existing local authentication (SSH agent / credential helper).
  GIT_TERMINAL_PROMPT: '0',
  GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=10',
  ...extra,
});

export async function run(bin: string, args: string[], options: RunOptions = {}): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = execFile(
      bin,
      args,
      {
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
  const child = spawn(bin, args, {
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
  return { pid: child.pid ?? -1, pgid: child.pid ?? -1, exited };
}

/** Signal a whole process group. Falls back to the single pid on failure. */
export function signalGroup(pgid: number, signal: NodeJS.Signals, fallbackPid?: number): void {
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
