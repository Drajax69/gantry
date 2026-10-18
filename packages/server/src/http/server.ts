import { ZodError } from 'zod';
import { workspaceWorkflow, saveWorkspaceWorkflow } from '../projects/workflow.js';
import { ticketWorkflow, changeStep, replaceGraph, saveTicketWorkflow } from '../tickets/workflow.js';
import { workspacePrompt, saveWorkspacePrompt } from '../projects/prompt.js';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import type { GantryApp } from '../app.js';
import { buildStatus, readLogTail } from '../status.js';
import { applySecurityHeaders, artifactHeaders, hostAllowed, sameOriginMutation } from './security.js';
import { resolveArtifact } from '../artifacts/artifacts.js';
import { templateBody, buildPromptVars, renderPrompt, repositoryPath } from '../prompts/engine.js';
import { findInstructionFiles } from '../prompts/instructions.js';
import { readPreviewLoginEmail } from '../supervisor/preview-login.js';
import { initializeWorkspace } from '../projects/initialize.js';
import { ticketWorkspace } from '../tickets/workspace.js';
import { validateTicketInput, type TicketInput } from '../tickets/store.js';

/**
 * HTTP API + dashboard host. Routes are grouped by concern in ./routes/*;
 * this file wires them and applies the security gate.
 */

export async function createHttpServer(app: GantryApp) {
  const fastify = Fastify({ logger: false, bodyLimit: 2_000_000 });

  // ---- security gate -------------------------------------------------------
  fastify.addHook('onRequest', async (request, reply) => {
    if (!hostAllowed(request, app.ctx.settings)) {
      return reply.code(403).send({ error: 'Local access only' });
    }
    const isMutation = request.method !== 'GET' && request.method !== 'HEAD';
    if (isMutation && !sameOriginMutation(request, app.ctx.settings)) {
      return reply.code(403).send({ error: 'Same-origin requests only' });
    }
  });

  fastify.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({ error: 'Not found' });
  });
  fastify.setErrorHandler((error, _request, reply) => {
    const statusCode = (error as { statusCode?: number }).statusCode ?? 400;
    reply.code([404, 409].includes(statusCode) ? statusCode : 400).send({ error: error instanceof ZodError ? error.issues.map(issue => issue.message).join(' ') : (error as Error).message });
  });

  // ---- static dashboard ----------------------------------------------------
  const uiDir = app.ctx.uiDir;
  if (uiDir && fs.existsSync(path.join(uiDir, 'index.html'))) {
    await fastify.register(fastifyStatic, { root: path.resolve(uiDir), prefix: '/' });
  }

  // ---- status --------------------------------------------------------------
  fastify.get('/api/status', async (_request, reply) => {
    applySecurityHeaders(reply, 'application/json; charset=utf-8');
    return buildStatus(app);
  });

  fastify.get('/api/version', async () => ({ version: '0.1.0' }));

  // Request authoritative merge reconciliation; callers cannot mark tickets done.
  fastify.post('/api/pulls/reconcile', async () => {
    await app.remote.sync(true);
    if (app.remote.lastError) throw new Error(app.remote.lastError);
    return { ok: true, checkedAt: app.remote.lastSyncAt };
  });

  // ---- projects ------------------------------------------------------------
  fastify.post('/api/projects', async (request, reply) => {
    const body = request.body as { workspace?: string; initialize?: boolean };
    if (!body.workspace || typeof body.workspace !== 'string') throw new Error('Provide a workspace directory containing gantry.yaml');
    if (body.initialize) await initializeWorkspace(body.workspace);
    const project = await app.addWorkspace(body.workspace);
    return reply.code(201).send({ ok: true, projectId: project.config.project.id });
  });

  fastify.delete('/api/projects/:projectId', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const removed = await app.removeWorkspace(projectId);
    if (!removed) throw Object.assign(new Error('Unknown project'), { statusCode: 404 });
    return { ok: true };
  });

  fastify.post('/api/projects/:projectId/refresh', async (request) => {
    const { projectId } = request.params as { projectId: string };
    await app.loadProjectById(projectId); // 404 when unknown
    app.jobs.enqueue('remote-sync', { projectId, dedupeKey: 'remote-sync' });
    await app.supervisor.tick();
    return { ok: true };
  });

  fastify.get('/api/projects/:projectId/chat-prompt', async request => {
    return workspacePrompt(await app.loadProjectById((request.params as { projectId: string }).projectId));
  });
  fastify.post('/api/projects/:projectId/chat-prompt', async request => {
    return saveWorkspacePrompt(await app.loadProjectById((request.params as { projectId: string }).projectId), (request.body as { prompt?: unknown })?.prompt);
  });

  fastify.get('/api/projects/:projectId/workflow', async request => {
    return workspaceWorkflow(await app.loadProjectById((request.params as { projectId: string }).projectId));
  });
  fastify.post('/api/projects/:projectId/workflow', async request => {
    return saveWorkspaceWorkflow(await app.loadProjectById((request.params as { projectId: string }).projectId), request.body);
  });
  fastify.get('/api/tickets/:ticketId/workflow', async request => {
    const ticket = app.tickets.get((request.params as { ticketId: string }).ticketId);
    if (!ticket) throw Object.assign(new Error('Ticket not found.'), { statusCode: 404 });
    return ticketWorkflow(ticket);
  });
  for (const action of ['workflow', 'workflow-progress'] as const) {
    fastify.post(`/api/tickets/:ticketId/${action}`, async request => {
      const ticket = app.tickets.get((request.params as { ticketId: string }).ticketId);
      if (!ticket) throw Object.assign(new Error('Ticket not found.'), { statusCode: 404 });
      const current = ticketWorkflow(ticket);
      const body = request.body as { graph?: unknown; revision?: number };
      if (!body || body.revision !== (current?.revision ?? -1)) throw Object.assign(new Error('Graph changed. Reload and try again.'), { statusCode: 409 });
      if (ticket.status === 'done') throw new Error('Reopen this ticket before changing its graph.');
      if (action === 'workflow-progress' && !current) throw new Error('Add a ticket graph first.');
      const next = action === 'workflow' ? replaceGraph(current, body.graph) : changeStep(current!, body);
      return saveTicketWorkflow(app.db, ticket, next);
    });
  }

  // ---- prompt preview ------------------------------------------------------
  fastify.post('/api/projects/:projectId/prompt-preview', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const body = request.body as { templateId?: string; title?: string; description?: string; scope?: string; branch?: string; additions?: string | null; agentId?: string };
    const project = await app.loadProjectById(projectId);
    const templateId = body.templateId ?? project.config.project.defaultPromptTemplate;
    const body_ = templateBody(project.config, templateId);
    const ticket = {
      id: 'preview-only',
      project_id: projectId,
      title: body.title ?? 'Example ticket',
      description: body.description ?? '',
      status: 'backlog' as const,
      scope: body.scope ?? project.config.scopes[0]?.id ?? 'both',
      branch: body.branch ?? `${project.config.project.branchPrefix}/example`,
      additions: body.additions ?? null,
      position: 0,
      active_run_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const vars = buildPromptVars(project, ticket, {
      artifactDir: path.join(app.ctx.artifactsDir, ticket.id),
      previewUrl: null,
      previewLoginEmail: await readPreviewLoginEmail(app.ctx.dataDir),
      urls: Object.fromEntries(project.config.services.map((service) => [service.id, (service.openUrl ?? 'http://127.0.0.1:PORT').replace('${port}', 'PORT')])),
      paths: Object.fromEntries(project.config.services.map((service) => [service.id, repositoryPath(project, service.repository)])),
    });
    const rendered = renderPrompt(project, ticket, vars, {
      workflowPort: app.ctx.settings.port,
      ticket,
      project,
      instructionFiles: await findInstructionFiles(project),
      agentNotes: app.agents.get(body.agentId ?? project.config.project.defaultAgent)?.promptNotes ?? '',
      ticketAdditions: ticket.additions,
    });
    return { templateId, templateLabel: body_.label, template: body_.body, rendered: rendered.prompt, layers: rendered.layers };
  });

  // ---- tickets -------------------------------------------------------------
  fastify.post('/api/projects/:projectId/tickets', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await app.loadProjectById(projectId);
    const ticket = app.tickets.create(projectId, request.body as unknown as TicketInput, project.config.scopes.map((scope) => scope.id), project.config.project.branchPrefix, workspaceWorkflow(project));
    return reply.code(201).send(ticket);
  });

  fastify.post('/api/projects/:projectId/tickets/reorder', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const body = request.body as { status?: string; ticketIds?: string[] };
    return app.tickets.reorder(projectId, String(body.status), body.ticketIds ?? []);
  });

  fastify.post('/api/tickets/:ticketId/update', async (request) => {
    const { ticketId } = request.params as { ticketId: string };
    const ticket = app.tickets.get(ticketId);
    if (!ticket) throw Object.assign(new Error('Ticket not found.'), { statusCode: 404 });
    const project = await app.loadProjectById(ticket.project_id);
    const validated = validateTicketInput(request.body as unknown as TicketInput, ticket, project.config.project.branchPrefix);
    const updated = app.tickets.update(ticketId, validated, project.config.scopes.map((scope) => scope.id), project.config.project.branchPrefix);
    if (updated.status === 'done') await app.supervisor.stopDonePreviews();
    return updated;
  });

  fastify.post('/api/tickets/:ticketId/delete', async (request) => {
    const { ticketId } = request.params as { ticketId: string };
    app.tickets.remove(ticketId);
    return { ok: true };
  });

  fastify.post('/api/tickets/:ticketId/prompt', async (request) => {
    const { ticketId } = request.params as { ticketId: string };
    const body = (request.body ?? {}) as { agentId?: string };
    const ticket = app.tickets.get(ticketId);
    if (!ticket) throw Object.assign(new Error('Ticket not found.'), { statusCode: 404 });
    const project = await app.loadProjectById(ticket.project_id);
    const agentId = body.agentId ?? project.config.project.defaultAgent;
    const vars = buildPromptVars(project, ticket, {
      artifactDir: path.join(app.ctx.artifactsDir, ticket.id),
      previewUrl: null,
      previewLoginEmail: await readPreviewLoginEmail(app.ctx.dataDir),
      urls: Object.fromEntries(project.config.services.map((service) => [service.id, (service.openUrl ?? 'http://127.0.0.1:PORT').replace('${port}', 'PORT')])),
      paths: Object.fromEntries(project.config.services.map((service) => [service.id, repositoryPath(project, service.repository)])),
    });
    const rendered = renderPrompt(project, ticket, vars, {
      workflowPort: app.ctx.settings.port,
      ticket,
      project,
      instructionFiles: await findInstructionFiles(project),
      agentNotes: app.agents.get(agentId)?.promptNotes ?? '',
      ticketAdditions: ticket.additions,
    });
    return { agentId, prompt: rendered.prompt, layers: rendered.layers };
  });

  const preparing = new Map<string, Promise<unknown>>();
  fastify.get('/api/tickets/:ticketId/workspace', async request => {
    return ticketWorkspace(app, (request.params as { ticketId: string }).ticketId);
  });
  fastify.post('/api/tickets/:ticketId/prepare', async request => {
    const { ticketId } = request.params as { ticketId: string };
    let task = preparing.get(ticketId);
    if (!task) {
      task = ticketWorkspace(app, ticketId, true).finally(() => preparing.delete(ticketId));
      preparing.set(ticketId, task);
    }
    return task;
  });

  // Start: queues the durable job and returns immediately (202).
  fastify.post('/api/tickets/:ticketId/start', async (request, reply) => {
    const { ticketId } = request.params as { ticketId: string };
    const body = (request.body ?? {}) as { agentId?: string; prompt?: string };
    const ticket = app.tickets.get(ticketId);
    if (!ticket) throw Object.assign(new Error('Ticket not found.'), { statusCode: 404 });
    const active = app.jobs.activeJobFor(`start-ticket:${ticketId}`);
    if (active) return reply.code(202).send({ ok: true, jobId: active.id, deduped: true });
    const job = app.jobs.enqueue('start-ticket', {
      payload: { agentId: body.agentId, prompt: body.prompt },
      projectId: ticket.project_id,
      ticketId,
      dedupeKey: `start-ticket:${ticketId}`,
    });
    return reply.code(202).send({ ok: true, jobId: job.id });
  });

  fastify.post('/api/tickets/:ticketId/handoff', async (request) => {
    const { ticketId } = request.params as { ticketId: string };
    const run = app.agents.activeRunForTicket(ticketId);
    if (!run) throw Object.assign(new Error('No active agent run for this ticket.'), { statusCode: 409 });
    const result = await app.agents.takeover(run.id, app.ctx.settings.takeoverGraceMs);
    if (!result.ok) throw new Error(result.error ?? 'Takeover failed.');
    return result;
  });

  fastify.post('/api/tickets/:ticketId/resume', async (request) => {
    const { ticketId } = request.params as { ticketId: string };
    const run = app.agents.activeRunForTicket(ticketId) ?? latestRun(app, ticketId);
    if (!run?.session_id) throw Object.assign(new Error('This run has no session id to resume.'), { statusCode: 409 });
    const project = await app.loadProjectById(run.project_id);
    const adapter = app.agents.get(run.agent);
    if (!adapter) throw new Error(`Agent "${run.agent}" is not registered.`);
    const config = app.agents.agentConfig(project, run.agent);
    const resolved = await adapter.resolveBinary(config.binary);
    if (!resolved.path) throw new Error(`${adapter.label} is not installed.`);
    const spec = adapter.buildResume(run.session_id, { workspace: run.workspace ?? project.workspace, prompt: '', addDirs: [], binary: resolved.path, args: config.args });
    if (!spec) throw Object.assign(new Error(`${adapter.label} does not support resuming sessions.`), { statusCode: 409 });
    return { terminal: { argv: spec.argv, cwd: spec.cwd } };
  });

  // ---- previews ------------------------------------------------------------
  fastify.post('/api/previews/:previewId/:action', async (request) => {
    const { previewId, action } = request.params as { previewId: string; action: string };
    const body = (request.body ?? {}) as { confirm?: boolean; environmentId?: string };
    const preview = app.supervisor.previewRow(previewId);
    if (!preview) throw Object.assign(new Error('Unknown preview'), { statusCode: 404 });
    if (app.supervisor.isDonePreview(previewId)) throw Object.assign(new Error('Reopen the ticket before using its preview.'), { statusCode: 409 });
    switch (action) {
      case 'pause':
        await app.supervisor.setPaused(previewId, true);
        break;
      case 'resume':
        await app.supervisor.setPaused(previewId, false);
        break;
      case 'restart':
        await app.supervisor.restartPreview(previewId);
        break;
      case 'retry-dependencies':
        await app.supervisor.retryDependencies(previewId);
        break;
      case 'archive':
        if (!body.confirm) throw new Error('Archiving a preview requires confirmation (confirm: true).');
        await app.supervisor.setArchived(previewId, true);
        break;
      case 'restore':
        await app.supervisor.restorePreview(previewId);
        break;
      case 'environment': {
        if (!body.environmentId) throw new Error('Provide environmentId');
        const project = await app.loadProjectById(preview.project_id);
        if (!project.config.environments.some((env) => env.id === body.environmentId)) throw new Error(`Unknown environment "${body.environmentId}"`);
        await app.supervisor.setEnvironment(previewId, body.environmentId);
        break;
      }
      default:
        throw new Error(`Unknown preview action "${action}"`);
    }
    return { ok: true };
  });

  // ---- logs + artifacts ----------------------------------------------------
  fastify.get('/logs/preview/:previewId/:serviceId', async (request, reply) => {
    const { previewId, serviceId } = request.params as { previewId: string; serviceId: string };
    if (!/^[\w-]+$/.test(previewId) || !/^[\w-]+$/.test(serviceId)) throw new Error('Invalid log path');
    applySecurityHeaders(reply, 'text/plain; charset=utf-8');
    return readLogTail(path.join(app.ctx.logsDir, `${previewId}-${serviceId}.log`));
  });

  fastify.get('/logs/run/:runId', async (request, reply) => {
    const { runId } = request.params as { runId: string };
    if (!/^[\w-]+$/.test(runId)) throw new Error('Invalid run id');
    applySecurityHeaders(reply, 'text/plain; charset=utf-8');
    return readLogTail(path.join(app.ctx.logsDir, `run-${runId}.log`));
  });

  fastify.get('/artifacts/:ticketId/:file', async (request, reply) => {
    const { ticketId, file } = request.params as { ticketId: string; file: string };
    const artifact = resolveArtifact(app.ctx.artifactsDir, ticketId, file);
    if (!artifact) throw Object.assign(new Error('Artifact not found'), { statusCode: 404 });
    const content = await fsp.readFile(artifact.path).catch(() => null);
    if (!content) throw Object.assign(new Error('Artifact not found'), { statusCode: 404 });
    artifactHeaders(reply, artifact.type, artifact.disposition, artifact.file, content.length);
    return content;
  });

  return fastify;
}

function latestRun(app: GantryApp, ticketId: string) {
  return app.db.prepare('SELECT * FROM runs WHERE ticket_id=? ORDER BY started_at DESC LIMIT 1').get(ticketId) as { session_id: string | null; agent: string; workspace: string | null; project_id: string } | undefined;
}
