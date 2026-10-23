import fs from 'node:fs/promises';
import path from 'node:path';
import type { GantryApp } from '../app.js';
import { git, isAncestor } from '../git/git.js';
import { listWorktrees, type WorktreeInfo } from '../git/worktrees.js';
import { mergedEvidence } from '../discover/merge-evidence.js';

export interface CleanupCheckout {
  repositoryId: string;
  path: string;
  head: string;
  eligible: boolean;
  reason: string;
}

export interface CleanupAssessment {
  ticketId: string;
  ticketIds: string[];
  checkouts: CleanupCheckout[];
  blockers: string[];
}

/** On-demand, local-only assessment. Cached discovery paths never authorize deletion. */
export async function assessTicketCleanup(app: GantryApp, ticketId: string): Promise<CleanupAssessment> {
  const ticket = app.tickets.get(ticketId);
  if (!ticket) throw Object.assign(new Error('Ticket not found.'), { statusCode: 404 });
  const project = await app.loadProjectById(ticket.project_id);
  const blockers: string[] = [];
  const peers = app.tickets.all(ticket.project_id).filter(t => t.branch === ticket.branch);
  if (peers.some(t => t.status !== 'done')) blockers.push('Every ticket sharing this branch must be Done.');
  if (peers.some(t => t.active_run_id)) blockers.push('An agent run is still attached to this branch.');
  if (peers.some(t => app.jobs.activeJobFor(`start-ticket:${t.id}`))) blockers.push('Ticket work is queued or running.');
  const active = app.db.prepare(`SELECT 1 FROM runs r JOIN tickets t ON t.id=r.ticket_id
    WHERE t.project_id=? AND t.branch=? AND r.state IN ('starting', 'running', 'interrupting') LIMIT 1`).get(ticket.project_id, ticket.branch);
  if (active) blockers.push('An agent is still working on this branch.');
  const previews = app.db.prepare('SELECT id, merge_evidence FROM previews WHERE project_id=? AND branch=? AND is_primary=0').all(ticket.project_id, ticket.branch) as { id: string; merge_evidence: string | null }[];
  for (const preview of previews) {
    if (app.db.prepare("SELECT 1 FROM preview_services WHERE preview_id=? AND (pid IS NOT NULL OR state IN ('installing', 'starting', 'ready')) LIMIT 1").get(preview.id)) {
      blockers.push('Preview services are still active. Pause the preview and retry.');
    }
  }
  const checkouts: CleanupCheckout[] = [];
  for (const repo of project.config.repositories.filter(r => r.role === 'product')) {
    const repoPath = path.resolve(project.workspace, repo.path);
    let trees: WorktreeInfo[];
    try {
      trees = await listWorktrees(repoPath);
    } catch (error) {
      checkouts.push({ repositoryId: repo.id, path: repoPath, head: '', eligible: false, reason: `Repository could not be assessed: ${(error as Error).message}` });
      continue;
    }
    for (const tree of trees.filter(t => t.branch === ticket.branch)) {
      const item: CleanupCheckout = { repositoryId: repo.id, path: tree.path, head: tree.head, eligible: false, reason: '' };
      checkouts.push(item);
      try {
        const real = await fs.realpath(tree.path);
        if (tree.path === trees[0]?.path || real === await fs.realpath(repoPath) || ticket.branch === repo.defaultBranch) {
          throw new Error('Primary and default-branch checkouts are protected.');
        }
        const root = await fs.realpath(path.resolve(project.workspace, project.config.project.worktreeRoot));
        const relative = path.relative(root, real);
        if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative) || real !== path.resolve(tree.path)) {
          throw new Error('This checkout is outside the managed worktree root or uses a symlink.');
        }
        const raw = await git(repoPath, 'worktree', 'list', '--porcelain', '-z');
        if (raw.split('\0\0').some(record => record.startsWith(`worktree ${tree.path}\0`) && record.split('\0').some(line => line === 'locked' || line.startsWith('locked ')))) {
          throw new Error('This worktree is locked.');
        }
        if (await git(tree.path, 'status', '--porcelain', '--untracked-files=all', '--ignore-submodules=none')) throw new Error('This worktree has uncommitted or untracked files.');
        const head = await git(tree.path, 'rev-parse', 'HEAD');
        if (head !== tree.head || await git(tree.path, 'symbolic-ref', '--short', 'HEAD') !== ticket.branch) throw new Error('The checkout changed during assessment. Retry.');
        const base = await git(repoPath, 'rev-parse', `refs/remotes/${repo.remote}/${repo.defaultBranch}`);
        let merged = await isAncestor(repoPath, head, base);
        if (!merged) {
          for (const preview of previews) {
            const evidence = JSON.parse(preview.merge_evidence ?? '{}')[repo.id];
            const proof = evidence?.proof;
            if (proof?.head !== head || proof.path !== tree.path || proof.branch !== ticket.branch) continue;
            const pulls = app.remote.snapshotFor(ticket.project_id, repo.id)?.pullRefs ?? [];
            merged = Boolean(await mergedEvidence(repoPath, { head }, { number: evidence.number ?? 0, head, merge: null }, base, pulls));
            if (merged) break;
          }
        }
        if (!merged) throw new Error('The current HEAD has no verified merge evidence against the local remote-default ref. Refresh merge status and retry.');
        item.eligible = true;
        item.reason = 'Clean and merged';
      } catch (error) {
        item.reason = (error as Error).message;
      }
    }
  }
  return { ticketId, ticketIds: peers.map(t => t.id).sort(), checkouts, blockers };
}

/** Reassess each checkout immediately before non-forced Git removal; retain partial results. */
export async function cleanupTicketWorktrees(app: GantryApp, ticketId: string, selected: unknown) {
  if (!Array.isArray(selected) || !selected.length || selected.length > 100 || selected.some(item => !item || typeof item.repositoryId !== 'string' || typeof item.path !== 'string' || typeof item.head !== 'string')) {
    throw new Error('Select assessed worktrees to remove.');
  }
  const results: { repositoryId: string; path: string; status: 'removed' | 'blocked' | 'failed'; reason: string }[] = [];
  for (const selection of selected as { repositoryId: string; path: string; head: string }[]) {
    try {
      const assessment = await assessTicketCleanup(app, ticketId);
      const current = assessment.checkouts.find(c => c.repositoryId === selection.repositoryId && c.path === selection.path);
      let reason = assessment.blockers.join(' ');
      if (!reason && !current) reason = 'Worktree is no longer registered on this branch.';
      if (!reason && current?.head !== selection.head) reason = 'HEAD changed. Review a fresh assessment.';
      if (!reason && !current?.eligible) reason = current?.reason ?? 'Worktree is not eligible.';
      if (reason) {
        results.push({ ...selection, status: 'blocked', reason });
        continue;
      }
      const ticket = app.tickets.get(ticketId)!;
      const project = await app.loadProjectById(ticket.project_id);
      const repo = project.config.repositories.find(r => r.id === selection.repositoryId)!;
      await git(path.resolve(project.workspace, repo.path), 'worktree', 'remove', '--', selection.path);
      app.db.prepare('DELETE FROM preview_checkouts WHERE repository_id=? AND path=?').run(selection.repositoryId, selection.path);
      results.push({ ...selection, status: 'removed', reason: 'Worktree removed; branch retained.' });
    } catch (error) {
      results.push({ ...selection, status: 'failed', reason: (error as Error).message });
    }
  }
  return { results, assessment: await assessTicketCleanup(app, ticketId) };
}
