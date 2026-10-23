import { afterAll, beforeEach, expect, test, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { PreparedTarget } from '../desktop/src/lib/server/targets';

const mocks = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  return { home: fs.mkdtempSync(path.join(os.tmpdir(), 'gantry-review-chat-')), driver: vi.fn() };
});
vi.mock('server-only', () => ({}));
vi.mock('../desktop/src/lib/server/exec', () => ({ DIRS: { chats: mocks.home }, safeName: (id: string) => id.replace(/[^\w.-]+/g, '_') }));
vi.mock('../desktop/src/lib/server/agents', () => ({
  getAgent: () => ({ id: 'opencode', name: 'OpenCode', kind: 'opencode' }),
  drivers: { opencode: mocks.driver },
}));
import { loadChat, pendingFor, send } from '../desktop/src/lib/server/chats';

const id = 'example/app/pull/1';
const checkout = path.join(mocks.home, 'checkout');
const target = { info: { id, kind: 'pull', owner: 'example', repo: 'app', title: 'Update app', headSha: 'head', baseSha: 'base' }, worktree: checkout, description: 'Review this change.' } as PreparedTarget;

beforeEach(() => {
  mocks.driver.mockReset();
  fs.mkdirSync(checkout, { recursive: true });
  mocks.driver.mockImplementation(async input => {
    // The agent edit lands in the checkout passed to the driver.
    fs.writeFileSync(path.join(input.cwd, 'review-edit.txt'), 'Local edit\n');
    input.hooks.session(input.sessionId ?? 'ses_correct_checkout');
    input.hooks.text('Updated the local file.');
  });
});
afterAll(() => fs.rmSync(mocks.home, { recursive: true, force: true }));

test.each([undefined, '/old/gantry-directory', checkout])('review session with directory %s preserves history and binds to the correct checkout', async directory => {
  fs.writeFileSync(path.join(mocks.home, 'example_app_pull_1.json'), JSON.stringify({
    targetId: id, title: target.info.title, updatedAt: 0,
    sessions: { opencode: { id: 'ses_old', directory, costUsd: 1 } },
    messages: [{ id: 'earlier', role: 'user', text: 'Keep the original requirement.', anchor: null, ts: 0 }],
  }));
  send(target, { text: 'Make the requested edit.', anchor: null });
  await vi.waitFor(() => expect(pendingFor(id)).toBeNull());
  const input = mocks.driver.mock.calls[0][0];
  expect(input.cwd).toBe(checkout);
  expect(input.system).toContain(`Local checkout: ${checkout}`);
  expect(input.sessionId).toBe(directory === checkout ? 'ses_old' : null);
  expect(input.history).toEqual([{ role: 'user', text: 'Keep the original requirement.' }]);
  expect(fs.readFileSync(path.join(checkout, 'review-edit.txt'), 'utf8')).toBe('Local edit\n');
  const chat = loadChat(id)!;
  expect(chat.messages.map(message => message.text)).toEqual(['Keep the original requirement.', 'Make the requested edit.', 'Updated the local file.']);
  expect(chat.sessions?.opencode.directory).toBe(checkout);
  expect(chat.sessions?.opencode.id).toBe(directory === checkout ? 'ses_old' : 'ses_correct_checkout');
  // The next reply must reuse the repaired session rather than starting over.
  send(target, { text: 'Check the change.', anchor: null });
  await vi.waitFor(() => expect(pendingFor(id)).toBeNull());
  expect(mocks.driver.mock.calls[1][0].sessionId).toBe(chat.sessions?.opencode.id);
});
