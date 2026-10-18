import { beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ gh: vi.fn(), getTarget: vi.fn(), localChanges: vi.fn(), pendingFor: vi.fn(), queuedFor: vi.fn() }));
vi.mock('../desktop/src/lib/server/exec', () => ({ gh: mocks.gh, withLock: (_: string, fn: () => unknown) => fn() }));
vi.mock('../desktop/src/lib/server/targets', () => ({ getTarget: mocks.getTarget }));
vi.mock('../desktop/src/lib/server/local-changes', () => ({ localChanges: mocks.localChanges }));
vi.mock('../desktop/src/lib/server/chats', () => ({ pendingFor: mocks.pendingFor, queuedFor: mocks.queuedFor }));
vi.mock('server-only', () => ({}));
import { mergePull } from '../desktop/src/lib/server/merge';
const head = 'a'.repeat(40);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getTarget.mockResolvedValue({ repoDir: '/isolated', info: { headSha: head } });
  mocks.localChanges.mockResolvedValue({ files: [], commits: 0 });
  mocks.queuedFor.mockReturnValue([]);
  mocks.gh.mockResolvedValueOnce(JSON.stringify({ state: 'open', head: { sha: head }, draft: false })).mockResolvedValueOnce(JSON.stringify({ merged: true }));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
});
test('merges only the reviewed SHA and requests authoritative ticket reconciliation', async () => {
  expect(await mergePull('TEST_merge/repo/pull/1', head, 'squash')).toEqual({ merged: true, warning: null });
  expect(mocks.gh).toHaveBeenLastCalledWith('api', '--method', 'PUT', 'repos/TEST_merge/repo/pulls/1/merge', '-f', `sha=${head}`, '-f', 'merge_method=squash');
  expect(fetch).toHaveBeenCalledOnce();
});
test.each(['dirty', 'agent', 'stale', 'draft', 'closed', 'rejected'])('does not reconcile when merge is blocked: %s', async reason => {
  if (reason === 'dirty') mocks.localChanges.mockResolvedValue({ files: [{}], commits: 0 });
  if (reason === 'agent') mocks.pendingFor.mockReturnValue({});
  if (['stale', 'draft', 'closed', 'rejected'].includes(reason)) {
    mocks.gh.mockReset().mockResolvedValueOnce(JSON.stringify({ state: reason === 'closed' ? 'closed' : 'open', head: { sha: reason === 'stale' ? 'b'.repeat(40) : head }, draft: reason === 'draft' })).mockResolvedValueOnce(JSON.stringify({ merged: false, message: 'Blocked by checks' }));
  }
  await expect(mergePull('TEST_merge/repo/pull/1', head, 'squash')).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});
test('reports merge success separately from unavailable ticket sync', async () => {
  vi.mocked(fetch).mockRejectedValue(new Error('offline'));
  const result = await mergePull('TEST_merge/repo/pull/1', head, 'merge');
  expect(result.merged).toBe(true);
  expect(result.warning).toContain('next syncs');
});
test('rejects malformed requests before accessing a target', async () => {
  await expect(mergePull('../repo/pull/1', head, 'squash')).rejects.toThrow('Invalid');
  expect(mocks.getTarget).not.toHaveBeenCalled();
});
