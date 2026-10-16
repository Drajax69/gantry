import fs from 'node:fs/promises';
import path from 'node:path';
import { idFor } from '@gantry/shared';
import type { ProjectConfig } from '@gantry/shared';
import type { LoadedProject } from '../projects/registry.js';
import { ensureWorktree, listWorktrees, type WorktreeInfo } from '../git/worktrees.js';

/**
 * Fast, local-only discovery: `git worktree list` per product repository and
 * grouping of the results by branch name. No network, no GitHub, no service
 * operations — cheap enough to run every few seconds.
 *
 * Grouping rules (generalized from the legacy manager):
 * - The primary checkout of each repository (the workspace's own clone) forms
 *   the default-branch group when it is on the configured default branch.
 * - Other worktrees group by exact branch name across repositories.
 * - A group missing one `required` repository falls back to that repository's
 *   primary checkout (a one-sided worktree still gets a full preview).
 * - Optional repositories join only on an exact branch match — their code is
 *   never substituted from an unrelated checkout.
 */

export interface Checkout {
  repositoryId: string;
  path: string;
  head: string;
  branch: string | null;
  isPrimary: boolean;
  isFallback: boolean;
}

export interface PreviewGroup {
  id: string;
  projectId: string;
  branchKey: string;
  branch: string | null;
  isPrimary: boolean;
  checkouts: Checkout[];
}

/** Ensure a default-branch checkout without switching or resetting user work. */
export async function ensureMainCheckouts(project: LoadedProject): Promise<void> {
  for (const repo of project.config.repositories.filter(repo => repo.role === 'product')) {
    const repoDir = path.resolve(project.workspace, repo.path);
    if (!(await fs.stat(repoDir).catch(() => null))) continue;
    if ((await listWorktrees(repoDir)).some(tree => tree.branch === repo.defaultBranch)) continue;
    await ensureWorktree({ repoPath: repoDir, repo, branch: repo.defaultBranch, worktreeRoot: path.resolve(project.workspace, project.config.project.worktreeRoot) });
  }
}

export async function discoverGroups(project: LoadedProject): Promise<PreviewGroup[]> {
  const config: ProjectConfig = project.config;
  const productRepos = config.repositories.filter((repo) => repo.role === 'product');
  const groups = new Map<string, PreviewGroup>();
  const repoPath = (repoId: string): string => path.resolve(project.workspace, config.repositories.find((repo) => repo.id === repoId)!.path);

  const trees = new Map<string, WorktreeInfo[]>();
  for (const repo of productRepos) {
    const repoDir = repoPath(repo.id);
    const stat = await fs.stat(repoDir).catch(() => null);
    trees.set(repo.id, stat ? await listWorktrees(repoDir) : []);
  }

  const add = (key: string, isPrimary: boolean, checkout: Checkout): void => {
    const group = groups.get(key) ?? {
      id: idFor(`gantry-preview:${config.project.id}:${key}`),
      projectId: config.project.id,
      branchKey: key,
      branch: isPrimary ? null : checkout.branch,
      isPrimary,
      checkouts: [],
    };
    group.checkouts.push(checkout);
    groups.set(key, group);
  };

  for (const repo of productRepos) {
    for (const tree of trees.get(repo.id) ?? []) {
      const isPrimaryCheckout = path.resolve(tree.path) === path.resolve(repoPath(repo.id));
      const isMain = tree.branch === repo.defaultBranch;
      const key = isMain ? '__primary__' : tree.branch ?? `detached:${path.dirname(tree.path)}`;
      add(key, isMain, {
        repositoryId: repo.id,
        path: path.resolve(tree.path),
        head: tree.head,
        branch: tree.branch,
        isPrimary: isPrimaryCheckout,
        isFallback: false,
      });
    }
  }

  // Fallbacks and optional-repo exclusion.
  const primaryByRepo = new Map<string, Checkout>();
  for (const group of groups.values()) {
    for (const checkout of group.checkouts) {
      if (checkout.isPrimary) primaryByRepo.set(checkout.repositoryId, checkout);
    }
  }
  for (const group of groups.values()) {
    const present = new Set(group.checkouts.map((checkout) => checkout.repositoryId));
    if (group.isPrimary) continue;
    for (const repo of productRepos) {
      if (present.has(repo.id)) continue;
      const primary = primaryByRepo.get(repo.id);
      // Required repositories fall back to the primary checkout so a one-sided
      // worktree still produces a working preview. Optional repositories are
      // never substituted — unrelated code must not join the preview.
      if (repo.required && primary) {
        group.checkouts.push({ ...primary, isFallback: true });
      }
    }
    group.checkouts.sort((a, b) => a.repositoryId.localeCompare(b.repositoryId));
  }

  return [...groups.values()].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.branchKey.localeCompare(b.branchKey));
}

/** Repositories a ticket needs worktrees for (worktree-enabled product repos). */
export function ticketRepositories(config: ProjectConfig): ProjectConfig['repositories'] {
  return config.repositories.filter((repo) => repo.worktree && repo.role === 'product');
}
