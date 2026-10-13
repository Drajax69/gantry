import { test, describe, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { importLegacyWorkspace } from '../packages/server/src/importer/legacy.js';
import { openDatabase } from '../packages/server/src/db/db.js';
import { parseProjectConfig } from '../packages/shared/src/config/schema.js';
import { parse as parseYaml } from 'yaml';
import { initFixtureRepo, tempDir, write } from './helpers.js';

const cleanups: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup().catch(() => {});
});

interface LegacyFixture {
  workspace: string;
  stateDir: string;
  cleanup: () => Promise<void>;
}

/** Fabricate a legacy workspace exactly as the old manager laid it out. */
async function makeLegacyWorkspace(): Promise<LegacyFixture> {
  const { dir, cleanup } = await tempDir('gantry-migrate-');
  cleanups.push(cleanup);
  const workspace = path.join(dir, 'chetami-like');
  const stateDir = path.join(workspace, '.local', 'previews');
  await fs.mkdir(stateDir, { recursive: true });
  await initFixtureRepo(path.join(workspace, 'examify'));
  await initFixtureRepo(path.join(workspace, 'examify-backend'));
  await fs.mkdir(path.join(workspace, 'examify-e2e'), { recursive: true });

  await write(
    path.join(stateDir, 'tickets.json'),
    JSON.stringify({
      tickets: [
        { id: 'legacy-1', title: 'First imported ticket', description: 'notes one', status: 'done', scope: 'both', branch: 'codex/first', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z', chat: null },
        { id: 'legacy-2', title: 'Second imported ticket', description: '', status: 'in_progress', scope: 'frontend', branch: 'codex/second', createdAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z', chat: { status: 'finished', threadId: 'thread-abc-123', pid: null, startedAt: '2026-10-03T01:00:00.000Z' } },
        { id: 'legacy-3', title: 'Third imported ticket', description: 'stale pid must not be trusted', status: 'backlog', scope: 'testing', branch: 'codex/third', chat: { status: 'running', threadId: 'thread-def-456', pid: 999999, workspace: '/gone' } },
      ],
    }),
  );
  await write(
    path.join(stateDir, 'config.json'),
    JSON.stringify({ paused: ['preview-a'], removed: ['preview-b'], profiles: { 'preview-a': 'papersetter' } }),
  );
  await write(
    path.join(stateDir, 'state.json'),
    JSON.stringify({
      ports: { 'preview-a': { frontend: 5200, backend: 5201 } },
      previews: {
        'preview-a': { name: 'codex/ticket-1', profile: 'papersetter', services: { frontend: { pid: 1234 }, backend: { pid: 1235 } } },
        'preview-b': { name: 'codex/ticket-2' },
      },
    }),
  );
  await fs.mkdir(path.join(stateDir, 'profiles', 'papersetter'), { recursive: true });
  await write(path.join(stateDir, 'profiles', 'papersetter', 'frontend.env'), 'VITE_BRAND=papersetter\nVITE_FIREBASE_PROJECT_ID=example\n');
  await write(path.join(stateDir, 'profiles', 'papersetter', 'backend.env'), 'JWT_SECRET=example-not-a-real-secret\n');
  return { workspace, stateDir, cleanup };
}

describe('importLegacyWorkspace (dry run)', () => {
  test('validates and reports without writing anything', async () => {
    const fixture = await makeLegacyWorkspace();
    const report = await importLegacyWorkspace({ workspace: fixture.workspace, stateDir: fixture.stateDir, dryRun: true });
    assert.equal(report.dryRun, true);
    // No files were written.
    await assert.rejects(fs.access(path.join(fixture.workspace, 'gantry.yaml')), /ENOENT/, 'dry run must not write gantry.yaml');
    assert.equal(report.imported.tickets, 3);
    assert.equal(report.imported.ticketsWithSessions, 2, 'thread ids counted, not pids');
    assert.deepEqual(report.imported.repositories.sort(), ['backend', 'e2e', 'frontend']);
    assert.deepEqual(report.imported.services.sort(), ['backend', 'frontend']);
    assert.deepEqual(report.imported.environments, ['papersetter']);
    assert.equal(report.imported.promptTemplate, 'builtin:paper-setter-legacy');
    assert.match(report.rollback, /legacy manager was not modified/);
  });
});

describe('importLegacyWorkspace (real run)', () => {
  test('writes the config, migrates tickets and port preferences, imports no processes', async () => {
    const fixture = await makeLegacyWorkspace();
    const dbFile = path.join(fixture.workspace, '.local', 'gantry-test.db');
    const db = openDatabase(dbFile);
    try {
      const report = await importLegacyWorkspace({ workspace: fixture.workspace, stateDir: fixture.stateDir }, db);
      assert.equal(report.dryRun, false);

      // The generated config is valid Gantry YAML with the legacy preset selected.
      const configFile = path.join(fixture.workspace, 'gantry.yaml');
      const raw = await fs.readFile(configFile, 'utf8');
      const parsed = parseProjectConfig(parseYaml(raw));
      assert.equal(parsed.ok, true, `generated config must validate: ${parsed.ok ? '' : parsed.errors.join('; ')}`);
      if (parsed.ok) {
        assert.equal(parsed.config.project.defaultPromptTemplate, 'builtin:paper-setter-legacy');
        assert.equal(parsed.config.project.branchPrefix, 'codex');
        assert.equal(parsed.config.environments[0]!.id, 'papersetter');
        // Secrets are referenced, never embedded.
        assert.ok(!raw.includes('example-not-a-real-secret'), 'no secret values in the config');
        assert.ok(raw.includes('papersetter/frontend.env'), 'env files are referenced by path');
      }

      // Tickets: order, fields and session ids preserved.
      const tickets = db.prepare('SELECT * FROM tickets ORDER BY position').all() as { title: string; branch: string; status: string; position: number }[];
      assert.equal(tickets.length, 3);
      assert.deepEqual(
        tickets.map((ticket) => ticket.title),
        ['First imported ticket', 'Second imported ticket', 'Third imported ticket'],
      );
      assert.deepEqual(tickets.map((ticket) => ticket.status), ['done', 'in_progress', 'backlog']);
      const runsCount = (db.prepare('SELECT COUNT(*) AS n FROM runs').all() as { n: number }[])[0]!.n;
      assert.equal(runsCount, 0, 'no runs are fabricated from thread ids');

      // Preview preferences: ports and paused/archived flags land as state.
      const preview = db.prepare('SELECT * FROM previews WHERE branch = ?').get('codex/ticket-1') as { id: string; environment: string | null } | undefined;
      assert.ok(preview, 'preview row created for the known branch');
      assert.equal(preview!.environment, 'papersetter');
      const ports = JSON.parse(JSON.stringify(db.prepare('SELECT service_id, port FROM port_allocations WHERE preview_id=? ORDER BY service_id').all(preview!.id))) as { service_id: string; port: number }[];
      assert.deepEqual(ports, [
        { service_id: 'backend', port: 5201 },
        { service_id: 'frontend', port: 5200 },
      ]);
      const archived = db.prepare('SELECT COUNT(*) AS n FROM previews WHERE branch = ? AND archived=1').get('codex/ticket-2') as { n: number };
      assert.equal(Number(archived.n), 1, 'removed legacy previews import as archived');

      // Stale PIDs are never imported as running processes.
      const services = JSON.parse(JSON.stringify(db.prepare('SELECT COUNT(*) AS n FROM preview_services').get())) as { n: number };
      assert.equal(services.n, 0, 'no preview_services rows: stale pids ignored');

      assert.match(report.rollback, /To abandon the migration/);
      assert.ok(report.attention.some((line) => /PIDs/.test(line)), 'stale PIDs are called out in the report');
    } finally {
      db.close();
    }
  });

  test('a second import does not duplicate tickets', async () => {
    const fixture = await makeLegacyWorkspace();
    const db = openDatabase(path.join(fixture.workspace, '.local', 'gantry-test2.db'));
    try {
      await importLegacyWorkspace({ workspace: fixture.workspace, stateDir: fixture.stateDir }, db);
      await importLegacyWorkspace({ workspace: fixture.workspace, stateDir: fixture.stateDir }, db);
      const count = (db.prepare('SELECT COUNT(*) AS n FROM tickets').all() as { n: number }[])[0]!.n;
      assert.equal(Number(count), 3, 'idempotent re-import');
    } finally {
      db.close();
    }
  });
});
