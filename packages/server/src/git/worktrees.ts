import fs from 'node:fs/promises';
import path from 'node:path';
import { idFor, worktreeFolderFor, type RepositoryConfig } from '@gantry/shared';
import { git, gitWithTimeout, refExists, startRef } from './git.js';

/**
 * Git worktree plumbing. Creation is idempotent: existing worktrees for the
 * same branch are reused wherever they live (Codex, Claude, or hand-made),
 * and existing branches are checked out rather than reset. Destructive flags
 * (force, detach of dirty trees) are deliberately not offered.
 */

export interface WorktreeInfo {
  path: string;
  head: string;
  branch: string | null;
  prunable: boolean;
}

/** Parse `git worktree list --porcelain -z` output; NUL-delimited, space-safe. */
export function parseWorktrees(raw: string): WorktreeInfo[] {
  return raw
    .split('\0\0')
    .filter(Boolean)
    .map((record) => {
      const item: Record<string, string | boolean> = {};
      for (const line of record.split('\0')) {
        const split = line.indexOf(' ');
        const key = split < 0 ? line : line.slice(0, split);
        item[key] = split < 0 ? true : line.slice(split + 1);
      }
      return {
        path: String(item.worktree ?? ''),
        head: String(item.HEAD ?? ''),
        branch: typeof item.branch === 'string' ? item.branch.replace(/^refs\/heads\//, '') : null,
        prunable: Boolean(item.prunable),
      };
    })
    .filter((item) => item.path && item.head && !item.prunable);
}

export async function listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
  return parseWorktrees(await git(repoPath, 'worktree', 'list', '--porcelain', '-z'));
}

export interface EnsureWorktreeResult {
  path: string;
  reused: boolean;
  head: string | null;
}

export interface EnsureWorktreeOptions {
  repoPath: string;
  repo: RepositoryConfig;
  branch: string;
  /** Where worktree groups live (workspace-relative name). */
  worktreeRoot: string;
  /** Bounded fetch budget before falling back to local refs. */
  fetchTimeoutMs?: number;
}

/**
 * Create or reuse the worktree for `branch` in one repository.
 * Order of preference for a new branch's start point:
 *   existing local branch -> existing remote branch -> remote default.
 * A failed fetch never fails ticket creation: local refs remain usable.
 */
export async function ensureWorktree(options: EnsureWorktreeOptions): Promise<EnsureWorktreeResult> {
  const { repoPath, repo, branch, worktreeRoot } = options;
  await git(repoPath, 'check-ref-format', '--branch', branch);
  const existing = (await listWorktrees(repoPath)).find((tree) => tree.branch === branch && tree.path !== repoPath);
  if (existing) return { path: existing.path, reused: true, head: existing.head };
  const destination = path.join(worktreeRoot, worktreeFolderFor(branch), path.basename(repoPath));
  const destinationStat = await fs.stat(destination).catch(() => null);
  if (destinationStat) {
    throw new Error(`Worktree destination already exists but is not a registered worktree: ${destination}`);
  }
  const localBranch = await refExists(repoPath, `refs/heads/${branch}`);
  const remoteBranch = await refExists(repoPath, `refs/remotes/${repo.remote}/${branch}`);
  let start: string | null = null;
  if (!localBranch && !remoteBranch) {
    // Bounded fetch for the default branch so new tickets start from a fresh
    // base. If the network is slow or absent, fall back to the local ref.
    try {
      await gitWithTimeout(repoPath, options.fetchTimeoutMs ?? 20_000, 'fetch', '--no-tags', repo.remote, repo.defaultBranch);
    } catch {
      /* offline or slow remote: local default is still a valid base */
    }
    start = await startRef(repoPath, repo.remote, repo.defaultBranch);
  }
  if (localBranch) {
    await git(repoPath, 'worktree', 'add', destination, branch);
  } else if (remoteBranch) {
    await git(repoPath, 'worktree', 'add', '-b', branch, destination, `refs/remotes/${repo.remote}/${branch}`);
  } else {
    await git(repoPath, 'worktree', 'add', '-b', branch, destination, start!);
  }
  const head = await git(destination, 'rev-parse', 'HEAD');
  return { path: destination, reused: false, head };
}

/** Prune stale worktree administrative entries without touching files. */
export async function pruneWorktrees(repoPath: string): Promise<void> {
  await git(repoPath, 'worktree', 'prune').catch(() => {});
}

/** Stable id for a (project, branch) preview group. */
export function previewIdFor(projectId: string, branchKey: string): string {
  return idFor(`gantry-preview:${projectId}:${branchKey}`);
}
