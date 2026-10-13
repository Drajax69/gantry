import { run, ExecError } from '../util/exec.js';

/** Thin Git wrapper. All calls use argument arrays — never shell strings. */
export function git(cwd: string, ...args: string[]): Promise<string> {
  return run('git', args, { cwd });
}

/** Git with an explicit timeout (network operations must never block starts). */
export function gitWithTimeout(cwd: string, timeoutMs: number, ...args: string[]): Promise<string> {
  return run('git', args, { cwd, timeoutMs });
}

export async function gitOk(cwd: string, ...args: string[]): Promise<boolean> {
  try {
    await git(cwd, ...args);
    return true;
  } catch (error) {
    if (error instanceof ExecError && error.code === 1) return false;
    throw error;
  }
}

export async function refExists(cwd: string, ref: string): Promise<boolean> {
  return gitOk(cwd, 'show-ref', '--verify', '--quiet', ref);
}

export async function isAncestor(cwd: string, head: string, base: string): Promise<boolean> {
  try {
    await git(cwd, 'merge-base', '--is-ancestor', head, base);
    return true;
  } catch (error) {
    if (error instanceof ExecError && error.code === 1) return false;
    throw error;
  }
}

export async function remoteDefaultRef(cwd: string, remote: string): Promise<string> {
  return git(cwd, 'symbolic-ref', `refs/remotes/${remote}/HEAD`);
}

/** Best ref to start a new branch from: remote default if known, else local default. */
export async function startRef(cwd: string, remote: string, defaultBranch: string): Promise<string> {
  try {
    return await remoteDefaultRef(cwd, remote);
  } catch {
    return defaultBranch;
  }
}

export async function isGitRepository(cwd: string): Promise<boolean> {
  try {
    await git(cwd, 'rev-parse', '--is-inside-work-tree');
    return true;
  } catch {
    return false;
  }
}

/** Uncommitted changes (staged or unstaged) in the checkout. */
export async function isDirty(cwd: string): Promise<boolean> {
  const status = await git(cwd, 'status', '--porcelain');
  return status.length > 0;
}

/**
 * True when a local branch has commits the upstream ref lacks (divergent
 * local-only work). Used to refuse destructive operations.
 */
export async function hasUnpushedCommits(cwd: string, remote: string, branch: string): Promise<boolean> {
  try {
    const ahead = await git(cwd, 'rev-list', '--count', `refs/remotes/${remote}/${branch}..refs/heads/${branch}`);
    return Number(ahead) > 0;
  } catch {
    return false;
  }
}
