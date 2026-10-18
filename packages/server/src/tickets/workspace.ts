import { findInstructionFiles } from '../prompts/instructions.js';
import { readPreviewLoginEmail } from '../supervisor/preview-login.js';
import path from 'node:path';
import type { GantryApp } from '../app.js';
import { ticketRepositories } from '../discover/discover.js';
import { ensureWorktree, listWorktrees, previewIdFor } from '../git/worktrees.js';
import { buildPromptVars, renderPrompt, repositoryPath } from '../prompts/engine.js';

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
  let prompt: string | undefined;
  if (prepare) {
    const previewId = previewIdFor(project.config.project.id, ticket.branch);
    const services = app.db.prepare('SELECT service_id, port FROM preview_services WHERE preview_id=?').all(previewId) as { service_id: string; port: number | null }[];
    const urls = Object.fromEntries(project.config.services.map(service => {
      const port = services.find(row => row.service_id === service.id)?.port;
      return [service.id, port ? (service.openUrl ?? 'http://127.0.0.1:${port}').replaceAll('${port}', String(port)) : '(preview not ready yet)'];
    }));
    const vars = buildPromptVars(project, ticket, {
      artifactDir: path.join(app.ctx.artifactsDir, ticket.id),
      previewUrl: urls.frontend ?? Object.values(urls)[0] ?? null,
      previewLoginEmail: await readPreviewLoginEmail(app.ctx.dataDir),
      urls,
      paths: Object.fromEntries(project.config.services.map(service => [service.id, checkouts.find(c => c.repositoryId === service.repository)?.path ?? repositoryPath(project, service.repository)])),
    });
    // Product repository variables must name the prepared worktrees, never the primary checkouts.
    for (const checkout of checkouts) vars[`repo.${checkout.repositoryId}`] = checkout.path;
    prompt = renderPrompt(project, ticket, vars, { workflowPort: app.ctx.settings.port, ticket, project, instructionFiles: await findInstructionFiles(project), agentNotes: '', ticketAdditions: ticket.additions }).prompt;
  }
  if (prepare && ticket.status === 'backlog') app.tickets.patch(ticketId, { status: 'in_progress' });
  return { ticket, prompt, project: { id: project.config.project.id, name: project.config.project.name, workspace: project.workspace }, checkouts };
}
