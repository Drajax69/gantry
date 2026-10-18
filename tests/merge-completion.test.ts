import { expect, test, vi } from 'vitest';
import { RemoteSync } from '../packages/server/src/discover/remote-sync.js';
import type { Database } from '../packages/server/src/db/db.js';
import type { LoadedProject } from '../packages/server/src/projects/registry.js';
import type { Logger } from '../packages/server/src/log.js';
vi.mock('../packages/server/src/discover/remote.js', () => ({ githubCliAvailable: async () => false }));
test('delivers confirmed branches to the ticket completion callback', async () => {
  const completed = vi.fn().mockResolvedValue(undefined);
  const project = {} as LoadedProject;
  const sync = new RemoteSync({} as Database, async () => [project], { warn: vi.fn() } as unknown as Logger, completed);
  vi.spyOn(sync as unknown as { syncProject: (p: LoadedProject, branches: Map<string, Set<string>>) => Promise<void> }, 'syncProject').mockImplementation(async (_, branches) => { branches.set('TEST_merge', new Set(['codex/TEST_merge'])); });
  await sync.sync();
  expect(completed).toHaveBeenCalledWith(new Map([['TEST_merge', new Set(['codex/TEST_merge'])]]));
  expect(sync.lastError).toBeNull();
});
test('a repository without a remote snapshot prevents partial ticket completion', async () => {
  const updates: unknown[][] = [];
  const db = { prepare: (sql: string) => ({
    all: () => sql.includes('preview_checkouts') ? [
      { repository_id: 'ready', path: '/ready', head: 'a', branch: 'TEST_merge', is_fallback: 0, is_primary: 0 },
      { repository_id: 'offline', path: '/offline', head: 'b', branch: 'TEST_merge', is_fallback: 0, is_primary: 0 },
    ] : [{ id: 'TEST_merge', branch: 'TEST_merge', merge_evidence: JSON.stringify({ ready: { evidence: 'Merged', proof: { head: 'a', path: '/ready', branch: 'TEST_merge', evidence: 'Merged' } } }) }],
    get: () => ({ merge_evidence: null }),
    run: (...args: unknown[]) => updates.push(args),
  }) } as unknown as Database;
  const sync = new RemoteSync(db, async () => [], {} as Logger, vi.fn());
  const branches = new Map<string, Set<string>>();
  await (sync as unknown as { recomputeEvidence: (p: LoadedProject, b: Map<string, Set<string>>) => Promise<void> }).recomputeEvidence({ config: { project: { id: 'TEST_merge' } } } as LoadedProject, branches);
  expect(updates[0][1]).toBe(0);
  expect(branches.size).toBe(0);
});
