import { test, describe, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, type Database } from '../packages/server/src/db/db.js';
import { PortAllocator, portFree } from '../packages/server/src/ports/ports.js';

const cleanups: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup().catch(() => {});
});

/** Bind an ephemeral port and keep it occupied until closed. */
function listenOnEphemeral(): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({ port, close: () => new Promise((done) => server.close(() => done())) });
    });
  });
}

async function makeAllocator(base = 20000): Promise<{ allocator: PortAllocator; db: Database; dir: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gantry-ports-'));
  const cleanup = () => fs.rm(dir, { recursive: true, force: true });
  cleanups.push(cleanup);
  const db = openDatabase(path.join(dir, 'test.db'));
  return { allocator: new PortAllocator(db), db, dir };
}

describe('portFree', () => {
  test('detects occupied and free ports on the loopback interface', async () => {
    const probe = await listenOnEphemeral();
    assert.equal(await portFree(probe.port), false);
    assert.equal(await portFree(probe.port + 1), true);
    await probe.close();
    // After close the OS may hold the socket briefly in TIME_WAIT; do not
    // assert freeness — only that the occupied case was detected.
  });
});

describe('PortAllocator', () => {
  test('allocation is sticky per (project, preview, service)', async () => {
    const { allocator } = await makeAllocator();
    const first = await allocator.allocate('proj', 'preview1', 'frontend', 20000, 200);
    const again = await allocator.allocate('proj', 'preview1', 'frontend', 20000, 200);
    assert.equal(first, again);
    assert.equal(allocator.existing('proj', 'preview1', 'frontend'), first);
  });

  test('services reserve distinct ports before either starts listening', async () => {
    const { allocator } = await makeAllocator();
    const a = await allocator.allocate('proj', 'same', 'frontend', 20000, 200);
    const b = await allocator.allocate('proj', 'same', 'runtime', 20000, 200);
    assert.notEqual(a, b);
  });

  test('different previews never share a port' , async () => {
    const { allocator } = await makeAllocator();
    const a = await allocator.allocate('proj', 'preview1', 'frontend', 20000, 200);
    const b = await allocator.allocate('proj', 'preview2', 'frontend', 20000, 200);
    assert.notEqual(a, b);
  });

  test('walks past ports occupied by real processes', async () => {
    const probe = await listenOnEphemeral();
    const { allocator } = await makeAllocator(probe.port);
    const allocated = await allocator.allocate('proj', 'p1', 'svc', probe.port, 50);
    assert.notEqual(allocated, probe.port);
    assert.ok(allocated >= probe.port && allocated < probe.port + 50);
    await probe.close();
  });

  test('honors a fixed port when free', async () => {
    const { allocator } = await makeAllocator();
    const port = await allocator.allocate('proj', 'p1', 'metrics', 20000, 50, 21000);
    assert.equal(port, 21000);
  });

  test('keeps an existing sticky allocation over a changed fixed request', async () => {
    const { allocator } = await makeAllocator();
    await allocator.allocate('proj', 'p1', 'metrics', 20000, 50, 21000);
    const sticky = await allocator.allocate('proj', 'p1', 'metrics', 20000, 50, 21001);
    assert.equal(sticky, 21000);
  });

  test('refuses a fixed port already assigned to another preview', async () => {
    const { allocator } = await makeAllocator();
    await allocator.allocate('proj', 'p1', 'svc', 20000, 50, 21010);
    await assert.rejects(() => allocator.allocate('proj', 'p2', 'svc', 20000, 50, 21010), /already assigned/);
  });

  test('refuses a fixed port occupied by another process', async () => {
    const probe = await listenOnEphemeral();
    const { allocator } = await makeAllocator();
    await assert.rejects(() => allocator.allocate('proj', 'p1', 'svc', 20000, 50, probe.port), /occupied/);
    await probe.close();
  });

  test('throws a helpful error when the range is exhausted', async () => {
    const probe = await listenOnEphemeral();
    const { allocator } = await makeAllocator(probe.port);
    await assert.rejects(() => allocator.allocate('proj', 'p1', 'svc', probe.port, 1), /No free port/);
    await probe.close();
  });

  test('release makes ports allocatable again', async () => {
    const { allocator } = await makeAllocator();
    const first = await allocator.allocate('proj', 'p1', 'svc', 20000, 200);
    await allocator.allocate('proj', 'p2', 'svc', 20000, 200);
    allocator.release('p2');
    const after = await allocator.allocate('proj', 'p3', 'svc', 20000, 200);
    assert.equal(after, first + 1);
  });

  test('allocations persist across database reopen', async () => {
    const { dir, allocator, db } = await makeAllocator();
    const port = await allocator.allocate('proj', 'p1', 'svc', 20000, 200);
    db.close();
    const reopened = openDatabase(path.join(dir, 'test.db'));
    const second = new PortAllocator(reopened);
    assert.equal(await second.allocate('proj', 'p1', 'svc', 20000, 200), port);
    reopened.close();
  });
});
