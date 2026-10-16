import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { initFixtureRepo, tempDir, git } from './helpers.js';
import { GantryApp } from '../packages/server/src/app.js';
import { createAppContext } from '../packages/server/src/config/app.js';
import { initializeWorkspace } from '../packages/server/src/projects/initialize.js';
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
    const ticket = app.tickets.create(project.config.project.id, { title: 'Build a feature', scope: 'both' }, project.config.scopes.map(s => s.id), 'ticket');
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
    app.tickets.patch(ticket.id, { status: 'done' });
    await assert.rejects(ticketWorkspace(app, ticket.id, true), /Reopen/);
  } finally { app.db.close(); if (previousData === undefined) delete process.env.GANTRY_DATA_DIR; else process.env.GANTRY_DATA_DIR = previousData; await temp.cleanup(); }
});
