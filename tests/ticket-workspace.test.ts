import { workspacePrompt, saveWorkspacePrompt } from '../packages/server/src/projects/prompt.js';
import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { initFixtureRepo, tempDir, git } from './helpers.js';
import { GantryApp } from '../packages/server/src/app.js';
import { createAppContext } from '../packages/server/src/config/app.js';
import { initializeWorkspace } from '../packages/server/src/projects/initialize.js';
import { DEFAULT_WORKFLOW } from '../packages/shared/src/workflow.js';
import { ticketWorkspace } from '../packages/server/src/tickets/workspace.js';

test('new workspace needs no provider config, prepares reusable ticket branches, protects primary and Done', async () => {
  const temp = await tempDir('gantry-ticket-chat-');
  const workspace = path.join(temp.dir, 'workspace');
  await initFixtureRepo(workspace);
  const previousData = process.env.GANTRY_DATA_DIR;
  process.env.GANTRY_DATA_DIR = path.join(temp.dir, 'data');
  const app = new GantryApp(createAppContext());
  try {
    await initializeWorkspace(workspace);
    const project = await app.addWorkspace(workspace);
    assert.equal(project.config.services.length, 0);
    const ticket = app.tickets.create(project.config.project.id, { title: 'Build a feature', scope: 'both' }, project.config.scopes.map(s => s.id), 'ticket', DEFAULT_WORKFLOW);
    assert.equal((await ticketWorkspace(app, ticket.id)).checkouts.length, 0);
    const first = await ticketWorkspace(app, ticket.id, true);
    assert.equal(first.checkouts.length, 1);
    assert.notEqual(first.checkouts[0]!.path, workspace);
    assert.equal(await git(first.checkouts[0]!.path, 'branch', '--show-current'), ticket.branch);
    await fs.writeFile(path.join(first.checkouts[0]!.path, 'work.txt'), 'keep this work');
    const again = await ticketWorkspace(app, ticket.id, true);
    assert.equal(again.checkouts[0]!.path, first.checkouts[0]!.path);
    assert.equal(await fs.readFile(path.join(again.checkouts[0]!.path, 'work.txt'), 'utf8'), 'keep this work');
    assert.equal(await git(workspace, 'status', '--porcelain'), '');
    const repoId = project.config.repositories[0]!.id;
    const custom = `Workspace instructions: implement ${'${ticket.title}'} at ${'${repo.' + repoId + '}'}; create a PR.`;
    const beforeConfig = await fs.readFile(project.configPath, 'utf8');
    assert.throws(() => saveWorkspacePrompt(project, 'Bad ${unknown.variable}'), /unknown|Unknown/);
    assert.equal(await fs.readFile(project.configPath, 'utf8'), beforeConfig);
    saveWorkspacePrompt(project, custom);
    const reloaded = await app.loadProjectById(project.config.project.id);
    assert.equal(workspacePrompt(reloaded).prompt, custom);
    assert.deepEqual(reloaded.config.repositories, project.config.repositories);
    const withPrompt = await ticketWorkspace(app, ticket.id, true);
    assert.ok(withPrompt.prompt?.includes(`implement Build a feature at ${first.checkouts[0]!.path}; create a PR.`));
    assert.ok(!withPrompt.prompt?.includes('${ticket.title}'));
    assert.ok(withPrompt.prompt?.includes('Ticket workflow'));
    assert.ok(withPrompt.stagePrompt?.includes(`implement Build a feature at ${first.checkouts[0]!.path}; create a PR.`));
    assert.ok(!withPrompt.stagePrompt?.includes('Ticket workflow'));
    assert.ok(!withPrompt.stagePrompt?.includes('workflow-progress'));
    app.tickets.patch(ticket.id, { status: 'done' });
    await assert.rejects(ticketWorkspace(app, ticket.id, true), /Reopen/);
  } finally { app.db.close(); if (previousData === undefined) delete process.env.GANTRY_DATA_DIR; else process.env.GANTRY_DATA_DIR = previousData; await temp.cleanup(); }
});

test('moving a ticket through the HTTP API does not prepare worktrees or start an agent', async () => {
  const { createHttpServer } = await import('../packages/server/src/http/server.js');
  const temp = await tempDir('gantry-status-only-');
  const workspace = path.join(temp.dir, 'workspace');
  await initFixtureRepo(workspace);
  const previousData = process.env.GANTRY_DATA_DIR;
  process.env.GANTRY_DATA_DIR = path.join(temp.dir, 'data');
  const app = new GantryApp(createAppContext());
  // Preview discovery is independent of this HTTP status-only contract.
  const tick = vi.spyOn(app.supervisor, 'tick').mockResolvedValue();
  const server = await createHttpServer(app);
  try {
    await initializeWorkspace(workspace);
    const project = await app.addWorkspace(workspace);
    const ticket = app.tickets.create(project.config.project.id, { title: 'TEST_f84f8f57_status_only', scope: 'both' }, project.config.scopes.map(s => s.id), 'ticket', DEFAULT_WORKFLOW);
    const response = await server.inject({
      method: 'POST', url: `/api/tickets/${ticket.id}/update`,
      headers: { host: `127.0.0.1:${app.ctx.settings.port}` },
      payload: { status: 'in_progress' },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(app.tickets.get(ticket.id)?.status, 'in_progress');
    assert.equal(app.tickets.get(ticket.id)?.active_run_id, null);
    assert.equal(app.jobs.activeJobFor(`start-ticket:${ticket.id}`), null);
    assert.equal((await ticketWorkspace(app, ticket.id)).checkouts.length, 0);
  } finally {
    await server.close();
    tick.mockRestore();
    await app.shutdown();
    if (previousData === undefined) delete process.env.GANTRY_DATA_DIR; else process.env.GANTRY_DATA_DIR = previousData;
    await temp.cleanup();
  }
});

test('HTTP scopes follow YAML services and round-trip through status, updates and prompt preview', async () => {
  const { createHttpServer } = await import('../packages/server/src/http/server.js');
  const temp = await tempDir('gantry-service-scopes-');
  const workspace = path.join(temp.dir, 'workspace');
  await initFixtureRepo(workspace);
  const previousData = process.env.GANTRY_DATA_DIR;
  process.env.GANTRY_DATA_DIR = path.join(temp.dir, 'data');
  const app = new GantryApp(createAppContext());
  const tick = vi.spyOn(app.supervisor, 'tick').mockResolvedValue();
  const server = await createHttpServer(app);
  try {
    await initializeWorkspace(workspace);
    const project = await app.addWorkspace(workspace);
    const repository = project.config.repositories[0]!.id;
    project.config.services = ['web', 'worker'].map((id) => ({
      id, repository, runtime: 'command', start: { kind: 'argv', value: ['node', '--version'] },
      dependsOn: [], env: {},
    })) as typeof project.config.services;
    project.config.scopes = [{ id: 'obsolete', label: 'Old category', description: 'Do not offer' }];
    await fs.writeFile(project.configPath, JSON.stringify(project.config));
    const headers = { host: `127.0.0.1:${app.ctx.settings.port}` };
    const post = (url: string, payload: unknown) => server.inject({ method: 'POST', url, headers, payload: JSON.stringify(payload) });
    // Fastify needs a JSON content type to parse the serialized payload.
    Object.assign(headers, { 'content-type': 'application/json' });
    const createUrl = `/api/projects/${project.config.project.id}/tickets`;
    const created = await post(createUrl, { title: 'TEST_service_scopes', scopes: ['web', 'worker', 'web'] });
    assert.equal(created.statusCode, 201, created.body);
    const ticket = created.json();
    assert.deepEqual(ticket.scopes, ['web', 'worker']);
    const updated = await post(`/api/tickets/${ticket.id}/update`, { scopes: ['worker'] });
    assert.equal(updated.statusCode, 200, updated.body);
    assert.deepEqual(updated.json().scopes, ['worker']);
    const partial = await post(`/api/tickets/${ticket.id}/update`, { description: 'Keep selection' });
    assert.deepEqual(partial.json().scopes, ['worker']);
    const status = await server.inject({ url: '/api/status', headers });
    assert.deepEqual(status.json().projects[0].scopes.map((scope: { id: string }) => scope.id), ['web', 'worker']);
    assert.deepEqual(status.json().tickets[0].scopes, ['worker']);
    const preview = await post(`/api/projects/${project.config.project.id}/prompt-preview`, { title: 'Preview', scopes: ['worker'] });
    assert.equal(preview.statusCode, 200, preview.body);
    assert.match(preview.json().rendered, /Scope: worker/);
    for (const scopes of [['obsolete'], ['missing'], 'web', null, [1]]) {
      assert.equal((await post(createUrl, { title: 'Invalid', scopes })).statusCode, 400);
      assert.equal((await post(`/api/projects/${project.config.project.id}/prompt-preview`, { scopes })).statusCode, 400);
    }
    assert.deepEqual((await post(createUrl, { title: 'Default selection' })).json().scopes, ['web', 'worker']);
    assert.deepEqual((await post(`/api/tickets/${ticket.id}/update`, { scopes: [] })).json().scopes, []);
    const legacy = app.tickets.create(project.config.project.id, { title: 'Legacy category', scope: 'testing' }, [], 'ticket');
    const legacyEdit = await post(`/api/tickets/${legacy.id}/update`, { description: 'Unrelated edit' });
    assert.equal(legacyEdit.statusCode, 200, legacyEdit.body);
    assert.equal(legacyEdit.json().scope, 'testing');
    const legacyStatus = (await server.inject({ url: '/api/status', headers })).json().tickets.find((entry: { id: string }) => entry.id === legacy.id);
    assert.equal(legacyStatus.scopeDescription, 'Legacy scope: testing');
    assert.deepEqual(legacyStatus.scopes, []);
  } finally {
    await server.close();
    tick.mockRestore();
    await app.shutdown();
    if (previousData === undefined) delete process.env.GANTRY_DATA_DIR; else process.env.GANTRY_DATA_DIR = previousData;
    await temp.cleanup();
  }
});
