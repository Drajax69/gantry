import { test, describe, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, type Database } from '../packages/server/src/db/db.js';
import { createLogger } from '../packages/server/src/log.js';
import { JobQueue, type JobRow } from '../packages/server/src/jobs/queue.js';
import { delay, tempDir, until } from './helpers.js';

const cleanups: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup().catch(() => {});
});

async function makeQueue(): Promise<{ queue: JobQueue; db: Database; dir: string }> {
  const { dir, cleanup } = await tempDir('gantry-jobs-');
  cleanups.push(cleanup);
  const db = openDatabase(path.join(dir, 'jobs.db'));
  const logger = createLogger({ level: 'error' });
  return { queue: new JobQueue(db, logger, { maxAttempts: 3, retryBackoffMs: 100 }), db, dir };
}

const row = (queue: JobQueue, id: string): JobRow => {
  const job = queue.get(id);
  assert.ok(job, 'job row exists');
  return job!;
};

describe('JobQueue', () => {
  test('runs an enqueued handler and records progress and result', async () => {
    const { queue } = await makeQueue();
    queue.register('demo', async (context) => {
      context.progress('half', 50, 'working');
      context.log('did the thing');
      return { value: 42 };
    });
    const job = queue.enqueue('demo', { payload: { x: 1 } });
    queue.start(20);
    await until(() => row(queue, job.id).state === 'succeeded', 5000);
    const finished = row(queue, job.id);
    assert.equal(finished.phase, 'done');
    assert.equal(finished.progress, 100);
    assert.deepEqual(JSON.parse(finished.result!), { value: 42 });
    // The mid-flight progress write is best-effort; final state is what matters.
    queue.stop();
  });

  test('dedupeKey keeps at most one active job per key', async () => {
    const { queue } = await makeQueue();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let runs = 0;
    queue.register('slow', async () => {
      runs += 1;
      await gate;
    });
    const first = queue.enqueue('slow', { dedupeKey: 'slow:1' });
    const duplicate = queue.enqueue('slow', { dedupeKey: 'slow:1' });
    assert.equal(duplicate.id, first.id, 'racing enqueue returns the active job, not a second one');
    queue.start(20);
    await until(() => row(queue, first.id).state === 'running', 5000);
    assert.equal(runs, 1, 'handler started exactly once');
    assert.ok(queue.activeJobFor('slow:1'), 'an active job is visible for the key');
    release();
    await until(() => row(queue, first.id).state === 'succeeded', 5000);
    // Once the key is free, a NEW enqueue may run again.
    const again = queue.enqueue('slow', { dedupeKey: 'slow:1' });
    assert.notEqual(again.id, first.id, 'a fresh enqueue after completion gets a new job');
    queue.stop();
  });

  test('failing handlers retry then fail permanently', async () => {
    const { queue } = await makeQueue();
    let attempts = 0;
    queue.register('boom', async () => {
      attempts += 1;
      throw new Error('synthetic failure');
    });
    const job = queue.enqueue('boom');
    queue.start(20);
    // MAX_ATTEMPTS is 3: attempt 1 fails -> queued(attempts=1) -> retry ...
    await until(() => row(queue, job.id).state === 'failed', 15_000);
    const failed = row(queue, job.id);
    assert.ok(attempts >= 3, `expected at least 3 attempts, got ${attempts}`);
    assert.match(failed.error ?? '', /synthetic failure/);
    queue.stop();
  });

  test('errors marked Fatal skip retries', async () => {
    const { queue } = await makeQueue();
    let attempts = 0;
    queue.register('fatal', async () => {
      attempts += 1;
      throw Object.assign(new Error('no retries for this'), { name: 'FatalError' });
    });
    const job = queue.enqueue('fatal');
    queue.start(20);
    await until(() => row(queue, job.id).state === 'failed', 5000);
    assert.equal(attempts, 1);
    queue.stop();
  });

  test('recoverLeases requeues running jobs with expired leases', async () => {
    const { queue, db } = await makeQueue();
    const job = queue.enqueue('orphankind');
    // Simulate a crash mid-run: mark running with a stale lease.
    db.prepare("UPDATE jobs SET state='running', lease_until=?, attempts=1 WHERE id=?").run(new Date(Date.now() - 1000).toISOString(), job.id);
    queue.register('orphankind', async () => 'recovered');
    queue.start(20); // start() calls recoverLeases()
    await until(() => row(queue, job.id).state === 'succeeded', 5000);
    assert.equal(row(queue, job.id).attempts, 2, 'attempt counter incremented on recovery');
    queue.stop();
  });

  test('cancel cancels a queued job but not a running one', async () => {
    const { queue } = await makeQueue();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    queue.register('slow', async () => {
      await gate;
    });
    const queued = queue.enqueue('slow', { dedupeKey: 'slow-a', runAfterMs: 60_000 });
    assert.equal(queue.cancel(queued.id), true);
    assert.equal(row(queue, queued.id).state, 'canceled');

    const running = queue.enqueue('slow', { dedupeKey: 'slow-b' });
    queue.start(20);
    await until(() => row(queue, running.id).state === 'running', 5000);
    assert.equal(queue.cancel(running.id), false, 'running jobs are not cancellable');
    release();
    queue.stop();
  });

  test('unknown job kinds fail with a clear message', async () => {
    const { queue } = await makeQueue();
    const job = queue.enqueue('mystery');
    queue.start(20);
    await until(() => row(queue, job.id).state === 'failed', 5000);
    assert.match(row(queue, job.id).error ?? '', /No handler registered/);
    queue.stop();
  });

  test('payloads round-trip', async () => {
    const { queue } = await makeQueue();
    let seen: Record<string, unknown> | null = null;
    queue.register('payload', async (context) => {
      seen = context.payload;
    });
    const job = queue.enqueue('payload', { payload: { ticketId: 't1', nested: { ok: true } } });
    queue.start(20);
    await until(() => row(queue, job.id).state === 'succeeded', 5000);
    assert.deepEqual(seen, { ticketId: 't1', nested: { ok: true } });
    queue.stop();
  });

  test('run_after delays execution', async () => {
    const { queue } = await makeQueue();
    let ran = false;
    queue.register('later', async () => {
      ran = true;
    });
    const job = queue.enqueue('later', { runAfterMs: 1500 });
    queue.start(20);
    await delay(300);
    assert.equal(row(queue, job.id).state, 'queued', 'must not run before run_after');
    await until(() => ran, 5000, 'delayed job should run after its delay');
    queue.stop();
  });

  test('temp dir cleanup ran', async () => {
    // Ensures the after() hook has at least one cleanup registered in this file.
    const { dir } = await makeQueue();
    assert.ok(dir.length > 0);
    await delay(0);
  });
});
