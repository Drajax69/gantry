import path from 'node:path';
import fs from 'node:fs/promises';
import type { Database } from '../../db/db.js';
import type { AppContext } from '../../config/app.js';
import type { Logger } from '../../log.js';
import type { LoadedProject } from '../../projects/registry.js';
import { ensureWorktree, previewIdFor } from '../../git/worktrees.js';
import { ticketRepositories } from '../../discover/discover.js';
import { ensureArtifactDirectory } from '../../artifacts/artifacts.js';
import { PortAllocator } from '../../ports/ports.js';
import { TicketStore } from '../../tickets/store.js';
import { AgentRegistry } from '../../agents/registry.js';
import { buildPromptVars, renderPrompt, repositoryPath } from '../../prompts/engine.js';
import { findInstructionFiles } from '../../prompts/instructions.js';
import { readPreviewLoginEmail } from '../../supervisor/preview-login.js';
import type { JobContext } from '../queue.js';

/**
 * The ticket-start job. Queued by POST /tickets/:id/start (which returns
 * immediately); this handler does the actual work in visible phases:
 *
 *   worktrees (10-50%) -> agent (60-90%) -> queued preview prep (100%)
 *
 * Fast, local, and idempotent: worktrees are reused, the run is locked by
 * tickets.active_run_id, and previews are prepared asynchronously by the
 * supervisor rather than blocking the agent.
 */

export interface StartTicketPayload {
  agentId?: string;
  prompt?: string;
}

export function createStartTicketHandler(deps: {
  ctx: AppContext;
  db: Database;
  log: Logger;
  loadProject: (projectId: string) => Promise<LoadedProject>;
  tickets: TicketStore;
  agents: AgentRegistry;
  ports: PortAllocator;
  enqueuePreviewPrep: (projectId: string) => void;
}) {
  return async function startTicket(context: JobContext<StartTicketPayload>): Promise<{ runId: string; sessionId: string | null }> {
    const { payload } = context;
    const ticketId = String(context.job.ticket_id);
    const ticket = deps.tickets.get(ticketId);
    if (!ticket) throw new Error('Ticket not found.');
    const project = await deps.loadProject(ticket.project_id);
    const agentId = payload.agentId ?? project.config.project.defaultAgent;

    // Atomic start lock: exactly one active run per ticket, even across
    // racing jobs or restarts (partial UNIQUE index on tickets.active_run_id).
    const runId = deps.agents.createRunRow(project.config.project.id, ticketId, agentId);
    if (!deps.tickets.claimRun(ticketId, runId)) {
      deps.db.prepare('DELETE FROM runs WHERE id=?').run(runId);
      throw Object.assign(new Error('This ticket already has an active agent run. Open or take over that session instead.'), { name: 'FatalError' });
    }
    // Parity with the legacy board: starting work moves the ticket forward.
    if (ticket.status === 'backlog') deps.tickets.patch(ticketId, { status: 'in_progress' });

    try {
      context.progress('worktrees', 10, 'Creating coordinated worktrees');
      const repos = ticketRepositories(project.config);
      const worktrees: { repositoryId: string; path: string }[] = [];
      for (const [index, repo] of repos.entries()) {
        const repoPath = repositoryPath(project, repo.id);
        context.progress('worktrees', 10 + Math.round((index / repos.length) * 40), `${repo.id}: preparing worktree`);
        const result = await ensureWorktree({ repoPath, repo, branch: ticket.branch, worktreeRoot: path.resolve(project.workspace, project.config.project.worktreeRoot) });
        context.log(`${repo.id}: ${result.reused ? 'reusing' : 'created'} ${result.path}`);
        worktrees.push({ repositoryId: repo.id, path: result.path });
      }

      context.progress('agent', 60, 'Rendering prompt');
      const artifactDir = await ensureArtifactDirectory(deps.ctx.artifactsDir, ticketId);
      // Allocate ports up front (sticky, local-only) so the prompt can name
      // the real preview URL even though services start in the background.
      const previewId = previewIdFor(project.config.project.id, ticket.branch);
      const portVars: Record<string, string> = {};
      let previewUrl: string | null = null;
      for (const service of project.config.services) {
        const checkout = worktrees.find((worktree) => worktree.repositoryId === service.repository);
        if (!checkout && service.repository !== 'e2e') continue;
        try {
          const port = await deps.ports.allocate(project.config.project.id, previewId, service.id, project.config.project.portBase, project.config.project.portRange, service.port);
          portVars[service.id] = String(port);
          const url = (service.openUrl ?? (service.healthUrl ? service.healthUrl : `http://127.0.0.1:\${port}`)).replace(/\$\{port\}/g, String(port));
          if (!previewUrl || service.id === 'frontend') previewUrl = url;
        } catch {
          /* port allocation failures surface in the supervisor; the agent still starts */
        }
      }
      const vars = buildPromptVars(project, ticket, {
        artifactDir,
        previewUrl,
        previewLoginEmail: await readPreviewLoginEmail(deps.ctx.dataDir),
        urls: Object.fromEntries(
          project.config.services.map((service) => [
            service.id,
            (service.openUrl ?? `http://127.0.0.1:\${port}`).replace(/\$\{port\}/g, portVars[service.id] ?? 'PORT'),
          ]),
        ),
        paths: Object.fromEntries(
          project.config.services.map((service) => [
            service.id,
            worktrees.find((worktree) => worktree.repositoryId === service.repository)?.path ?? repositoryPath(project, service.repository),
          ]),
        ),
      });
      const prompt =
        payload.prompt ??
        renderPrompt(project, ticket, vars, {
          workflowPort: deps.ctx.settings.port,
          ticket,
          project,
          instructionFiles: await findInstructionFiles(project),
          agentNotes: deps.agents.get(agentId)?.promptNotes ?? '',
          ticketAdditions: ticket.additions,
        }).prompt;

      context.progress('agent', 70, `Starting ${agentId}`);
      // The agent works from the workspace root (project parity: projectRoot)
      // with explicit access to the ticket worktrees and evidence directory.
      const addDirs = [...worktrees.map((worktree) => worktree.path), artifactDir];
      const run = await deps.agents.startRun(project, ticket, runId, { agentId, prompt, addDirs, artifactDir, workspace: project.workspace });
      context.progress('agent', 90, `${agentId} is working in the background`);

      // Previews prepare asynchronously; the agent never waits for them.
      deps.enqueuePreviewPrep(project.config.project.id);
      context.progress('preview', 95, 'Preview preparation queued');
      return { runId, sessionId: run.session_id };
    } catch (error) {
      deps.tickets.releaseRun(ticketId, runId);
      deps.db.prepare("UPDATE runs SET state='failed', ended_at=?, error=? WHERE id=?").run(new Date().toISOString(), (error as Error).message, runId);
      throw error;
    }
  };
}

/** Best-effort preview URL for prompt rendering (the real one comes up later). */
export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
}
