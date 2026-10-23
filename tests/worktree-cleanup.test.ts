import { expect, test, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { GantryApp } from '../packages/server/src/app.js';
import { createAppContext } from '../packages/server/src/config/app.js';
import { initializeWorkspace } from '../packages/server/src/projects/initialize.js';
import { ticketWorkspace } from '../packages/server/src/tickets/workspace.js';
import { assessTicketCleanup, cleanupTicketWorktrees } from '../packages/server/src/tickets/cleanup.js';
import { createHttpServer } from '../packages/server/src/http/server.js';
import * as gitTools from '../packages/server/src/git/git.js';
import { git, initFixtureRepo, tempDir, write } from './helpers.js';

async function fixture() {
  const temp = await tempDir('gantry-cleanup-');
  const workspace = path.join(temp.dir, 'workspace');
  await initFixtureRepo(workspace);
  const previous = process.env.GANTRY_DATA_DIR;
  process.env.GANTRY_DATA_DIR = path.join(temp.dir, 'data');
  const app = new GantryApp(createAppContext());
  vi.spyOn(app.supervisor, 'tick').mockResolvedValue();
  await initializeWorkspace(workspace);
  const project = await app.addWorkspace(workspace);
  const ticket = app.tickets.create(project.config.project.id, { title: 'TEST_cleanup' }, [], 'ticket');
  const work = await ticketWorkspace(app, ticket.id, true);
  const checkout = work.checkouts[0]!;
  app.tickets.patch(ticket.id, { status: 'done' });
  return {
    app, project, ticket, checkout, workspace, temp,
    close: async () => {
      app.db.close();
      if (previous === undefined) delete process.env.GANTRY_DATA_DIR;
      else process.env.GANTRY_DATA_DIR = previous;
      await temp.cleanup();
    },
  };
}

test('confirmed cleanup removes only the assessed checkout and retains ticket, branch and primary', async () => {
  const f = await fixture();
  const server = await createHttpServer(f.app);
  try {
    const assessment = await assessTicketCleanup(f.app, f.ticket.id);
    expect(assessment.blockers).toEqual([]);
    expect(assessment.checkouts[0]?.eligible).toBe(true);
    const url = `/api/tickets/${f.ticket.id}/worktree-cleanup`;
    const headers = { host: `127.0.0.1:${f.app.ctx.settings.port}` };
    const refused = await server.inject({ method: 'POST', url, headers, payload: { checkouts: assessment.checkouts } });
    expect(refused.statusCode).toBe(400);
    expect(await fs.stat(f.checkout.path)).toBeTruthy();
    const response = await server.inject({ method: 'POST', url, headers, payload: { confirm: true, checkouts: assessment.checkouts } });
    expect(response.statusCode).toBe(200);
    expect(response.json().results[0].status).toBe('removed');
    expect(response.json().assessment.checkouts).toEqual([]);
    expect(await fs.stat(f.checkout.path).catch(() => null)).toBeNull();
    expect(await git(f.workspace, 'rev-parse', `refs/heads/${f.ticket.branch}`)).toBe(assessment.checkouts[0]?.head);
    expect(f.app.tickets.get(f.ticket.id)?.status).toBe('done');
    expect(await git(f.workspace, 'branch', '--show-current')).toBe('main');
    const repeated = await cleanupTicketWorktrees(f.app, f.ticket.id, assessment.checkouts);
    expect(repeated.results[0]?.status).toBe('blocked');
  } finally {
    await server.close();
    await f.close();
  }
});

test.each(['untracked', 'tracked', 'locked', 'new-commit', 'reopened', 'shared-branch', 'queued', 'active-run', 'outside-root', 'forged-path'] as const)('cleanup revalidates %s after confirmation assessment', async scenario => {
  const f = await fixture();
  try {
    const before = await assessTicketCleanup(f.app, f.ticket.id);
    expect(before.checkouts[0]?.eligible).toBe(true);
    if (scenario === 'untracked') await write(path.join(f.checkout.path, 'untracked.txt'), 'keep');
    if (scenario === 'tracked') await write(path.join(f.checkout.path, 'README.md'), 'keep');
    if (scenario === 'locked') await git(f.workspace, 'worktree', 'lock', f.checkout.path);
    if (scenario === 'new-commit') {
      await write(path.join(f.checkout.path, 'new.txt'), 'keep');
      await git(f.checkout.path, 'add', '.');
      await git(f.checkout.path, 'commit', '-m', 'new unmerged work');
    }
    if (scenario === 'reopened') f.app.tickets.patch(f.ticket.id, { status: 'in_progress' });
    if (scenario === 'shared-branch') f.app.tickets.create(f.project.config.project.id, { title: 'TEST_peer', branch: f.ticket.branch }, [], 'ticket');
    if (scenario === 'queued') f.app.jobs.enqueue('start-ticket', { projectId: f.ticket.project_id, ticketId: f.ticket.id, dedupeKey: `start-ticket:${f.ticket.id}` });
    if (scenario === 'active-run') f.app.tickets.claimRun(f.ticket.id, 'TEST_run');
    if (scenario === 'outside-root') {
      const destination = path.join(f.temp.dir, 'external-checkout');
      await git(f.workspace, 'worktree', 'move', f.checkout.path, destination);
      before.checkouts[0]!.path = destination;
      f.checkout.path = destination;
    }
    if (scenario === 'forged-path') before.checkouts[0]!.path = f.workspace;
    const result = await cleanupTicketWorktrees(f.app, f.ticket.id, before.checkouts);
    expect(result.results[0]?.status).toBe('blocked');
    expect(await fs.stat(f.checkout.path)).toBeTruthy();
  } finally {
    await f.close();
  }
});

test('squash merge cleanup requires matching proof and rechecks its patch against the default ref', async () => {
  const f = await fixture();
  try {
    await write(path.join(f.checkout.path, 'feature.txt'), 'feature');
    await git(f.checkout.path, 'add', '.');
    await git(f.checkout.path, 'commit', '-m', 'feature');
    const head = await git(f.checkout.path, 'rev-parse', 'HEAD');
    await git(f.workspace, 'merge', '--squash', f.ticket.branch);
    await git(f.workspace, 'commit', '-m', 'squashed');
    await git(f.workspace, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    expect((await assessTicketCleanup(f.app, f.ticket.id)).checkouts[0]?.eligible).toBe(false);
    const now = new Date().toISOString();
    const proof = { [f.checkout.repositoryId]: { number: 1, evidence: 'Merged', proof: { head, path: f.checkout.path, branch: f.ticket.branch } } };
    f.app.db.prepare('INSERT INTO previews (id, project_id, branch, merge_evidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('TEST_preview', f.ticket.project_id, f.ticket.branch, JSON.stringify(proof), now, now);
    const assessment = await assessTicketCleanup(f.app, f.ticket.id);
    expect(assessment.checkouts[0]?.eligible).toBe(true);
    // Rewinding the default ref invalidates remembered merge evidence.
    await git(f.workspace, 'update-ref', 'refs/remotes/origin/main', 'HEAD~1');
    const result = await cleanupTicketWorktrees(f.app, f.ticket.id, assessment.checkouts);
    expect(result.results[0]?.status).toBe('blocked');
    expect(await fs.stat(f.checkout.path)).toBeTruthy();
  } finally {
    await f.close();
  }
});

test('cleanup reports partial failure and never removes an unassessed path', async () => {
  const f = await fixture();
  try {
    const assessment = await assessTicketCleanup(f.app, f.ticket.id);
    const result = await cleanupTicketWorktrees(f.app, f.ticket.id, [
      { repositoryId: f.checkout.repositoryId, path: f.workspace, head: assessment.checkouts[0]!.head },
      ...assessment.checkouts,
    ]);
    expect(result.results.map(r => r.status)).toEqual(['blocked', 'removed']);
    expect(await fs.stat(f.workspace)).toBeTruthy();
  } finally {
    await f.close();
  }
});

test('cleanup excludes preview discovery and concurrent ticket mutations', async () => {
  const f = await fixture();
  const server = await createHttpServer(f.app);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  try {
    const assessment = await assessTicketCleanup(f.app, f.ticket.id);
    const real = f.app.supervisor.withIdleProject.bind(f.app.supervisor);
    vi.spyOn(f.app.supervisor, 'withIdleProject').mockImplementation((id, action) => real(id, async () => { await gate; return action(); }));
    const headers = { host: `127.0.0.1:${f.app.ctx.settings.port}` };
    const cleaning = server.inject({ method: 'POST', url: `/api/tickets/${f.ticket.id}/worktree-cleanup?refresh=1`, headers, payload: { confirm: true, checkouts: assessment.checkouts } });
    const running = cleaning.then(value => value);
    await vi.waitFor(() => expect(f.app.cleanupProjects.has(f.ticket.project_id)).toBe(true));
    await expect(real(f.ticket.project_id, async () => true)).rejects.toThrow(/busy/);
    const update = await server.inject({ method: 'POST', url: `/api/tickets/${f.ticket.id}/update`, headers, payload: { status: 'in_progress' } });
    expect(update.statusCode).toBe(409);
    release();
    expect((await running).json().results[0].status).toBe('removed');
    expect(f.app.cleanupProjects.size).toBe(0);
  } finally {
    release();
    await server.close();
    await f.close();
  }
});

test('multi-repository cleanup removes merged companions while retaining dirty and unavailable repositories', async () => {
  const f = await fixture();
  try {
    const second = path.join(f.workspace, 'second');
    await initFixtureRepo(second);
    const secondTree = path.join(f.workspace, '.worktrees', 'TEST_second');
    await git(second, 'worktree', 'add', '-b', f.ticket.branch, secondTree);
    await write(path.join(secondTree, 'keep.txt'), 'untracked work');
    const original = f.project.config.repositories[0]!;
    vi.spyOn(f.app, 'loadProjectById').mockResolvedValue({
      ...f.project,
      config: {
        ...f.project.config,
        repositories: [original, { ...original, id: 'second', path: 'second' }, { ...original, id: 'missing', path: 'missing' }],
      },
    });
    const assessment = await assessTicketCleanup(f.app, f.ticket.id);
    expect(assessment.checkouts.map(c => c.eligible)).toEqual([true, false, false]);
    const result = await cleanupTicketWorktrees(f.app, f.ticket.id, assessment.checkouts);
    expect(result.results.map(r => r.status)).toEqual(['removed', 'blocked', 'blocked']);
    expect(await fs.readFile(path.join(secondTree, 'keep.txt'), 'utf8')).toBe('untracked work');
  } finally {
    await f.close();
  }
});

test('active preview services block removal and Git removal errors retain retryable results', async () => {
  const f = await fixture();
  let restore = () => {};
  try {
    const before = await assessTicketCleanup(f.app, f.ticket.id);
    const now = new Date().toISOString();
    f.app.db.prepare('INSERT INTO previews (id, project_id, branch, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('TEST_services', f.ticket.project_id, f.ticket.branch, now, now);
    f.app.db.prepare('INSERT INTO preview_services (preview_id, service_id, state, updated_at) VALUES (?, ?, ?, ?)')
      .run('TEST_services', 'TEST_service', 'installing', now);
    expect((await cleanupTicketWorktrees(f.app, f.ticket.id, before.checkouts)).results[0]?.status).toBe('blocked');
    f.app.db.prepare('DELETE FROM preview_services WHERE preview_id=?').run('TEST_services');
    const original = gitTools.git;
    const spy = vi.spyOn(gitTools, 'git').mockImplementation((cwd, ...args) => {
      if (args[0] === 'worktree' && args[1] === 'remove') return Promise.reject(new Error('TEST Git removal refused'));
      return original(cwd, ...args);
    });
    restore = () => spy.mockRestore();
    const result = await cleanupTicketWorktrees(f.app, f.ticket.id, before.checkouts);
    expect(result.results[0]?.status).toBe('failed');
    expect(result.results[0]?.reason).toBe('TEST Git removal refused');
    expect(result.assessment.checkouts[0]?.eligible).toBe(true);
    expect(await fs.stat(f.checkout.path)).toBeTruthy();
  } finally {
    restore();
    await f.close();
  }
});

test('primary and default-branch checkouts cannot be selected for cleanup', async () => {
  const f = await fixture();
  try {
    f.app.tickets.update(f.ticket.id, { title: f.ticket.title, branch: 'main' }, [], 'ticket');
    const assessment = await assessTicketCleanup(f.app, f.ticket.id);
    expect(assessment.checkouts[0]?.path).toBe(f.workspace);
    expect(assessment.checkouts[0]?.eligible).toBe(false);
    expect(assessment.checkouts[0]?.reason).toMatch(/protected/);
    expect((await cleanupTicketWorktrees(f.app, f.ticket.id, assessment.checkouts)).results[0]?.status).toBe('blocked');
    expect(await git(f.workspace, 'branch', '--show-current')).toBe('main');
  } finally {
    await f.close();
  }
});
