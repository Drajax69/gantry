import { test, describe, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { artifactDirectory, resolveArtifact, listTicketArtifacts, ensureArtifactDirectory } from '../packages/server/src/artifacts/artifacts.js';

const UUID = '0b7a3f2e-1c4d-4e5f-9a8b-7c6d5e4f3a2b';

const cleanups: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup().catch(() => {});
});

describe('resolveArtifact', () => {
  test('allows exactly the five evidence filenames', () => {
    const allowed: [string, string, string][] = [
      ['manual-test-needed.md', 'text/markdown; charset=utf-8', 'inline'],
      ['video.webm', 'video/webm', 'inline'],
      ['trace.zip', 'application/zip', 'attachment'],
      ['final.png', 'image/png', 'inline'],
      ['summary.md', 'text/markdown; charset=utf-8', 'inline'],
    ];
    for (const [file, type, disposition] of allowed) {
      const artifact = resolveArtifact('/artifacts', UUID, file);
      assert.ok(artifact, `${file} must be allowed`);
      assert.equal(artifact!.type, type);
      assert.equal(artifact!.disposition, disposition);
      assert.equal(artifact!.path, path.join('/artifacts', UUID, file));
    }
  });

  test('rejects path traversal and non-allowlisted files', () => {
    for (const file of ['../../etc/passwd', 'index.js', 'video.mp4', 'trace.zip.exe', '', '.', 'summary.md/../../escape', 'README.md']) {
      assert.equal(resolveArtifact('/artifacts', UUID, file), null, `${file} must be rejected`);
    }
  });

  test('rejects malformed ticket ids', () => {
    for (const id of ['not-a-uuid', '../../../etc', '123', '', `${UUID}/../..`, "0b7a3f2e-1c4d-4e5f-9a8b-7c6d5e4f3a2b'"]) {
      assert.equal(resolveArtifact('/artifacts', id, 'summary.md'), null, `ticket id ${id} must be rejected`);
    }
  });
});

describe('artifactDirectory', () => {
  test('throws for invalid ticket ids', () => {
    assert.throws(() => artifactDirectory('/artifacts', 'garbage'), /Invalid ticket id/);
    const dir = artifactDirectory('/artifacts', UUID);
    assert.ok(dir.startsWith('/artifacts/'));
  });
});

describe('listTicketArtifacts', () => {
  test('lists only files that exist on disk', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gantry-artifacts-'));
    cleanups.push(() => fs.rm(dir, { recursive: true, force: true }));
    const ticketDir = await ensureArtifactDirectory(dir, UUID);
    await fs.writeFile(path.join(ticketDir, 'summary.md'), '# Summary\n');
    await fs.writeFile(path.join(ticketDir, 'final.png'), Buffer.from([0x89, 0x50]));
    await fs.writeFile(path.join(ticketDir, 'not-allowed.txt'), 'ignored');
    const listed = await listTicketArtifacts(dir, UUID);
    const files = listed.map((artifact) => artifact.file).sort();
    assert.deepEqual(files, ['final.png', 'summary.md']);
    const summary = listed.find((artifact) => artifact.file === 'summary.md')!;
    assert.equal(summary.url, `/artifacts/${UUID}/summary.md`);
    assert.equal(summary.size, '# Summary\n'.length);
    assert.equal(summary.kind, 'summary');
  });

  test('returns an empty list for tickets without artifacts', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gantry-artifacts2-'));
    cleanups.push(() => fs.rm(dir, { recursive: true, force: true }));
    assert.deepEqual(await listTicketArtifacts(dir, UUID), []);
  });

  test('invalid ticket ids yield an empty list rather than a crash', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gantry-artifacts3-'));
    cleanups.push(() => fs.rm(dir, { recursive: true, force: true }));
    assert.deepEqual(await listTicketArtifacts(dir, '../../evil'), []);
  });
});
