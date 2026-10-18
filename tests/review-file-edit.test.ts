import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
vi.mock('server-only', () => ({}));
import { readEditableFile, saveEditableFile } from '../desktop/src/lib/server/file-edit';
let root: string;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'TEST_c72bda82_edit_')); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
test('saves exact text, including CRLF and trailing newlines, and rejects stale saves', async () => {
  const file = 'TEST_c72bda82_code.ts';
  await fs.writeFile(path.join(root, file), 'original\r\n');
  const loaded = await readEditableFile(root, file);
  const saved = await saveEditableFile(root, file, 'changed\r\n\r\n', loaded.revision);
  expect(await fs.readFile(path.join(root, file), 'utf8')).toBe('changed\r\n\r\n');
  expect(saved.revision).not.toBe(loaded.revision);
  await expect(saveEditableFile(root, file, 'stale', loaded.revision)).rejects.toMatchObject({ status: 409 });
  expect(await fs.readFile(path.join(root, file), 'utf8')).toBe(saved.text);
});
test.each(['../outside', '/etc/passwd', '.git/config', 'nested/../file', 'nested\\file', ''])('rejects unsafe path %s', async file => {
  await expect(readEditableFile(root, file)).rejects.toMatchObject({ status: 400 });
});
test('rejects symlink files and directories, hard links, binary, oversized and missing files', async () => {
  await fs.writeFile(path.join(root, 'TEST_c72bda82_text'), 'text');
  await fs.symlink(path.join(root, 'TEST_c72bda82_text'), path.join(root, 'link'));
  await fs.symlink(root, path.join(root, 'dir'));
  await fs.link(path.join(root, 'TEST_c72bda82_text'), path.join(root, 'hard'));
  await fs.writeFile(path.join(root, 'binary'), Buffer.from([0xff, 0x00]));
  await fs.writeFile(path.join(root, 'large'), 'x'.repeat(2_000_001));
  for (const file of ['link', 'dir/TEST_c72bda82_text', 'hard', 'binary', 'large']) {
    await expect(readEditableFile(root, file)).rejects.toMatchObject({ status: 400 });
  }
  await expect(readEditableFile(root, 'missing')).rejects.toMatchObject({ status: 404 });
});
test('preserves external edits and executable permissions', async () => {
  const file = 'TEST_c72bda82_script';
  const full = path.join(root, file);
  await fs.writeFile(full, 'one', { mode: 0o755 });
  const original = await readEditableFile(root, file);
  await fs.writeFile(full, 'external');
  await expect(saveEditableFile(root, file, 'mine', original.revision)).rejects.toMatchObject({ status: 409 });
  const latest = await readEditableFile(root, file);
  await saveEditableFile(root, file, 'mine', latest.revision);
  expect((await fs.stat(full)).mode & 0o777).toBe(0o755);
});
