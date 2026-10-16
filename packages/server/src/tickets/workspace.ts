import path from 'node:path';
import type { GantryApp } from '../app.js';
import { ticketRepositories } from '../discover/discover.js';
import { ensureWorktree, listWorktrees } from '../git/worktrees.js';
import { repositoryPath } from '../prompts/engine.js';

/** Provider-independent ticket checkouts. Never resets or replaces existing work. */
export async function ticketWorkspace(app: GantryApp, ticketId: string, prepare = false) {
  const ticket = app.tickets.get(ticketId);
  if (!ticket) throw Object.assign(new Error('Ticket not found.'), { statusCode: 404 });
  if (prepare && ticket.status === 'done') throw new Error('Reopen this ticket before starting work.');
  if (prepare && (ticket.active_run_id || app.jobs.activeJobFor(`start-ticket:${ticketId}`))) throw new Error('Take over the existing agent run before starting ticket chat.');
  const project = await app.loadProjectById(ticket.project_id);
  const checkouts: { repositoryId: string; path: string }[] = [];
  for (const repo of ticketRepositories(project.config)) {
    const repoPath = repositoryPath(project, repo.id);
    if (prepare) {
      const tree = await ensureWorktree({ repoPath, repo, branch: ticket.branch, worktreeRoot: path.resolve(project.workspace, project.config.project.worktreeRoot) });
      checkouts.push({ repositoryId: repo.id, path: tree.path });
    } else {
      const tree = (await listWorktrees(repoPath)).find(t => t.branch === ticket.branch && t.path !== repoPath);
      if (tree) checkouts.push({ repositoryId: repo.id, path: tree.path });
    }
  }
  if (prepare && !checkouts.length) throw new Error('Configure at least one worktree-enabled product repository in gantry.yaml.');
  if (prepare && ticket.status === 'backlog') app.tickets.patch(ticketId, { status: 'in_progress' });
  return { ticket, project: { id: project.config.project.id, name: project.config.project.name, workspace: project.workspace }, checkouts };
}
