import { test, describe, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../packages/server/src/db/db.js';
import { TicketStore, TicketError, validateTicketInput, type TicketRow } from '../packages/server/src/tickets/store.js';

const cleanups: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup().catch(() => {});
});

async function makeStore(): Promise<{ store: TicketStore; db: Awaited<ReturnType<typeof openDatabase>>; dir: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gantry-tickets-'));
  const cleanup = () => fs.rm(dir, { recursive: true, force: true });
  cleanups.push(cleanup);
  const db = openDatabase(path.join(dir, 'tickets.db'));
  // tickets.project_id references projects(id); create the fixture project.
  db.prepare(
    'INSERT INTO projects (id, name, workspace, config_path, default_agent, default_prompt_template, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run('proj', 'Proj', '/tmp/proj', '/tmp/proj/gantry.yaml', 'codex', 'builtin:default', new Date().toISOString(), new Date().toISOString());
  return { store: new TicketStore(db), db, dir };
}

const SCOPES = ['both', 'frontend', 'backend', 'operations', 'data', 'testing'];

describe('TicketStore.create', () => {
  test('derives the branch from the title with the project prefix', async () => {
    const { store } = await makeStore();
    const ticket = store.create('proj', { title: 'Fix exam timer!' }, SCOPES, 'codex');
    assert.equal(ticket.branch, 'codex/fix-exam-timer');
    assert.equal(ticket.status, 'backlog');
    assert.equal(ticket.scope, 'both');
    assert.equal(ticket.active_run_id, null);
  });

  test('new tickets go to the top of their column', async () => {
    const { store } = await makeStore();
    const first = store.create('proj', { title: 'First' }, SCOPES, 'codex');
    const second = store.create('proj', { title: 'Second' }, SCOPES, 'codex');
    const all = store.all('proj');
    assert.equal(all[0]!.id, second.id, 'newest ticket first');
    assert.equal(all[1]!.id, first.id);
    // NOTE: positions can collide (store.create bumps others after assigning
    // max+1); ordering stays correct via the created_at tiebreak.
  });

  test('rejects unknown scopes and invalid branches', async () => {
    const { store } = await makeStore();
    assert.throws(() => store.create('proj', { title: 'X', scope: 'mobile' }, SCOPES, 'codex'), TicketError);
    assert.throws(() => store.create('proj', { title: 'X', branch: '../escape' }, SCOPES, 'codex'), /Git/);
    assert.throws(() => store.create('proj', { title: '' }, SCOPES, 'codex'), /Title is required/);
  });
});

describe('TicketStore.update', () => {
  test('updates fields and bumps the ticket to the end of a new column', async () => {
    const { store } = await makeStore();
    const ticket = store.create('proj', { title: 'Original' }, SCOPES, 'codex');
    const updated = store.update(ticket.id, { title: 'Renamed', status: 'in_progress' }, SCOPES, 'codex');
    assert.equal(updated.title, 'Renamed');
    assert.equal(updated.status, 'in_progress');
    const column = store.all('proj').filter((candidate) => candidate.status === 'in_progress');
    assert.equal(column.length, 1);
  });

  test('branch cannot change once a run is claimed', async () => {
    const { store } = await makeStore();
    const ticket = store.create('proj', { title: 'Locked' }, SCOPES, 'codex');
    assert.equal(store.claimRun(ticket.id, 'run-1'), true);
    assert.throws(() => store.update(ticket.id, { title: 'Locked', branch: 'codex/other' }, SCOPES, 'codex'), /branch cannot change/);
    // Same branch is fine.
    const updated = store.update(ticket.id, { title: 'Locked (edited)' }, SCOPES, 'codex');
    assert.equal(updated.branch, ticket.branch);
  });

  test('unknown tickets throw', async () => {
    const { store } = await makeStore();
    assert.throws(() => store.update('missing-id', { title: 'X' }, SCOPES, 'codex'), TicketError);
  });
});

describe('claimRun / releaseRun', () => {
  test('exactly one run can be claimed', async () => {
    const { store } = await makeStore();
    const ticket = store.create('proj', { title: 'Single run' }, SCOPES, 'codex');
    assert.equal(store.claimRun(ticket.id, 'run-a'), true);
    assert.equal(store.claimRun(ticket.id, 'run-b'), false, 'second claim must fail');
    assert.equal(store.get(ticket.id)!.active_run_id, 'run-a');
    store.releaseRun(ticket.id, 'run-b'); // wrong run id: no-op
    assert.equal(store.get(ticket.id)!.active_run_id, 'run-a', 'wrong release is a no-op');
    store.releaseRun(ticket.id, 'run-a');
    assert.equal(store.get(ticket.id)!.active_run_id, null);
    assert.equal(store.claimRun(ticket.id, 'run-c'), true);
  });
});

describe('reorder', () => {
  test('applies a complete order within one column', async () => {
    const { store } = await makeStore();
    const a = store.create('proj', { title: 'A' }, SCOPES, 'codex');
    const b = store.create('proj', { title: 'B' }, SCOPES, 'codex');
    const c = store.create('proj', { title: 'C' }, SCOPES, 'codex');
    // Current column order as stored: a, b, c (ties break by creation time).
    const result = store.reorder('proj', 'backlog', [a.id, b.id, c.id]);
    assert.deepEqual(result.map((ticket) => ticket.id), [a.id, b.id, c.id]);
    assert.deepEqual(store.all('proj').filter((ticket) => ticket.status === 'backlog').map((ticket) => ticket.id), [a.id, b.id, c.id]);
  });

  test('rejects incomplete, duplicated, or foreign orders', async () => {
    const { store } = await makeStore();
    const a = store.create('proj', { title: 'A' }, SCOPES, 'codex');
    const b = store.create('proj', { title: 'B' }, SCOPES, 'codex');
    assert.throws(() => store.reorder('proj', 'backlog', [a.id]), /no longer matches/);
    assert.throws(() => store.reorder('proj', 'backlog', [a.id, a.id]), /no longer matches/);
    assert.throws(() => store.reorder('proj', 'backlog', [a.id, b.id, 'ghost']), /no longer matches/);
    assert.throws(() => store.reorder('proj', 'in_progress', [a.id, b.id]), /no longer matches/);
    assert.throws(() => store.reorder('proj', 'bogus', [a.id, b.id]), /Unknown ticket status/);
  });
});

describe('completeMergedBranches', () => {
  test('moves matching non-done tickets to done', async () => {
    const { store } = await makeStore();
    const open = store.create('proj', { title: 'Will merge', status: 'in_progress' }, SCOPES, 'codex');
    const done = store.create('proj', { title: 'Already done', status: 'done' }, SCOPES, 'codex');
    const other = store.create('proj', { title: 'Unrelated', status: 'in_progress' }, SCOPES, 'codex');
    const completed = store.completeMergedBranches('proj', new Set([open.branch]));
    assert.equal(completed.length, 1);
    assert.equal(completed[0]!.id, open.id);
    assert.equal(store.get(open.id)!.status, 'done');
    assert.equal(store.get(done.id)!.status, 'done');
    assert.equal(store.get(other.id)!.status, 'in_progress');
    // Idempotent: nothing left to complete.
    assert.deepEqual(store.completeMergedBranches('proj', new Set([open.branch])), []);
  });
});

describe('patch / remove', () => {
  test('patch updates selected fields', async () => {
    const { store } = await makeStore();
    const ticket = store.create('proj', { title: 'T' }, SCOPES, 'codex');
    store.patch(ticket.id, { additions: 'extra notes' });
    assert.equal(store.get(ticket.id)!.additions, 'extra notes');
    assert.equal(store.get(ticket.id)!.title, 'T');
  });

  test('remove deletes and throws for unknown ids', async () => {
    const { store } = await makeStore();
    const ticket = store.create('proj', { title: 'Doomed' }, SCOPES, 'codex');
    store.remove(ticket.id);
    assert.equal(store.get(ticket.id), null);
    assert.throws(() => store.remove(ticket.id), TicketError);
  });
});

describe('validateTicketInput', () => {
  test('defaults and limits', () => {
    const validated = validateTicketInput({ title: 'Hi' }, undefined, 'ticket');
    assert.equal(validated.branch, 'ticket/hi');
    assert.equal(validated.status, 'backlog');
    assert.equal(validated.scope, 'both');
    assert.equal(validated.additions, null);
    assert.throws(() => validateTicketInput({ title: 'x'.repeat(200) }), /140 characters or fewer/);
    assert.throws(() => validateTicketInput({ title: 'ok', description: 'x'.repeat(6000) }), /5000 characters or fewer/);
  });

  test('keeps previous values for partial updates', () => {
    const previous = {
      id: 't1',
      project_id: 'p',
      title: 'Old title',
      description: 'Old notes',
      status: 'in_progress' as const,
      scope: 'testing',
      branch: 'codex/old-title',
      additions: null,
      position: 0,
      active_run_id: null,
      created_at: '',
      updated_at: '',
    } satisfies TicketRow;
    const validated = validateTicketInput({ title: 'New title' }, previous, 'codex');
    assert.equal(validated.description, 'Old notes');
    assert.equal(validated.status, 'in_progress');
    assert.equal(validated.scope, 'testing');
    assert.equal(validated.branch, 'codex/old-title', 'existing branch is preserved');
  });
});
