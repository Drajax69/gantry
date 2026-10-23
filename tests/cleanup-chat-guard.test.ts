import { beforeEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => {
  const runs = new Map();
  const queues = new Map();
  const cleanup = new Set();
  Object.assign(globalThis, { __lensRuns: runs, __lensQueues: queues, __lensCleanupPaths: cleanup });
  return { runs, queues, cleanup };
});

vi.mock('server-only', () => ({}));
vi.mock('../desktop/src/lib/server/exec', () => ({ DIRS: { chats: '/fixture/chats' }, safeName: (id: string) => id }));
vi.mock('../desktop/src/lib/server/agents', () => ({ drivers: {}, getAgent: vi.fn() }));

import { checkoutsHaveAgents, send, withIdleCheckouts } from '../desktop/src/lib/server/chats';
import type { PreparedTarget } from '../desktop/src/lib/server/targets';

beforeEach(() => {
  state.runs.clear();
  state.queues.clear();
  state.cleanup.clear();
});

test('checkout cleanup rejects running and queued local-review agents', async () => {
  state.runs.set('review', { worktree: '/fixture/worktree', msg: {}, abort: new AbortController() });
  expect(checkoutsHaveAgents(['/fixture/worktree'])).toBe(true);
  expect(checkoutsHaveAgents(['/fixture/another'])).toBe(false);
  const remove = vi.fn();
  await expect(withIdleCheckouts(['/fixture/worktree'], remove)).rejects.toThrow(/agents/);
  expect(remove).not.toHaveBeenCalled();
  state.runs.clear();
  state.queues.set('review', [{ t: { worktree: '/fixture/worktree' }, user: {} }]);
  await expect(withIdleCheckouts(['/fixture/worktree'], remove)).rejects.toThrow(/agents/);
});

test('cleanup reserves paths before yielding, excludes new chat turns and releases after failure', async () => {
  await expect(withIdleCheckouts(['/fixture/worktree'], async () => {
    await Promise.resolve();
    expect(() => send({ worktree: '/fixture/worktree' } as PreparedTarget, { text: 'change files', anchor: null })).toThrow(/cleanup/);
    await expect(withIdleCheckouts(['/fixture/worktree'], async () => true)).rejects.toThrow(/agents/);
    throw new Error('TEST removal failed');
  })).rejects.toThrow('TEST removal failed');
  expect(state.cleanup.size).toBe(0);
  await expect(withIdleCheckouts(['/fixture/worktree'], async () => true)).resolves.toBe(true);
});
