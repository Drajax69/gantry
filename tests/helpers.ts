import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run_ = promisify(execFile);

/** Run a git command in a directory (offline, local only). */
export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run_('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  return stdout.trim();
}

/** Create a fresh temporary directory that is removed by the returned cleanup fn. */
export async function tempDir(prefix: string): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  // macOS /tmp is a symlink to /private/tmp; git reports the real path, so
  // resolve up front to keep constructed paths and git output comparable.
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
  return { dir, cleanup: () => fs.rm(dir, { recursive: true, force: true }) };
}

/** Write a file (creating parent directories). */
export async function write(file: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, contents);
}

/**
 * Initialize a real git repository with a self-referencing `origin` remote so
 * worktree creation and merge evidence work fully offline.
 */
export async function initFixtureRepo(repoDir: string, options: { branch?: string; commitMessage?: string } = {}): Promise<void> {
  const branch = options.branch ?? 'main';
  await fs.mkdir(repoDir, { recursive: true });
  await git(repoDir, 'init', '-b', branch);
  await git(repoDir, 'config', 'user.name', 'Gantry Tests');
  await git(repoDir, 'config', 'user.email', 'gantry@example.invalid');
  await write(path.join(repoDir, 'README.md'), `fixture ${path.basename(repoDir)}\n`);
  await git(repoDir, 'add', '.');
  await git(repoDir, 'commit', '-m', options.commitMessage ?? 'initial');
  // A local self-remote supplies origin/HEAD and refs/pull/* without GitHub.
  await git(repoDir, 'remote', 'add', 'origin', repoDir);
  await git(repoDir, 'update-ref', `refs/remotes/origin/${branch}`, 'HEAD');
  await git(repoDir, 'symbolic-ref', `refs/remotes/origin/HEAD`, `refs/remotes/origin/${branch}`);
}

/** Poll until `condition` is true or the deadline passes (then assert). */
export async function until(condition: () => boolean | Promise<boolean>, timeoutMs = 10_000, message = 'condition not met in time'): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await delay(100);
  }
  assert.ok(await condition(), message);
}

export const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Best-effort kill of a detached process group (verify before signaling). */
export async function killGroup(pgid: number, pid: number): Promise<void> {
  try {
    process.kill(-pgid, 0);
  } catch {
    return; // already gone
  }
  try {
    process.kill(-pgid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* gone */
    }
  }
  await delay(100);
}

export function assertMatches(actual: string, expected: RegExp, message?: string): void {
  assert.ok(expected.test(actual), message ?? `expected ${JSON.stringify(actual.slice(0, 300))} to match ${expected}`);
}
