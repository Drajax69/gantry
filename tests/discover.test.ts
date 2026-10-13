import { test, describe, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import path from 'node:path';
import { parseProjectConfig, type ProjectConfig } from '../packages/shared/src/config/schema.js';
import { discoverGroups } from '../packages/server/src/discover/discover.js';
import { ensureWorktree } from '../packages/server/src/git/worktrees.js';
import { matchPull, shouldRetire, mergedEvidence } from '../packages/server/src/discover/merge-evidence.js';
import type { PullRef } from '../packages/server/src/discover/remote.js';
import type { LoadedProject } from '../packages/server/src/projects/registry.js';
import { initFixtureRepo, tempDir, write, git } from './helpers.js';

const cleanups: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup().catch(() => {});
});

function buildConfig(repos: ProjectConfig['repositories']): ProjectConfig {
  const parsed = parseProjectConfig({
    apiVersion: 'gantry.dev/v1',
    project: { id: 'fixture', name: 'Fixture' },
    repositories: repos,
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error('invalid fixture config');
  return parsed.config;
}

interface Fixture {
  workspace: string;
  frontend: string;
  backend: string;
}

async function createWorkspace(options: { backendRequired: boolean }): Promise<Fixture> {
  const { dir, cleanup } = await tempDir('gantry-discover-');
  cleanups.push(cleanup);
  const frontend = path.join(dir, 'examify');
  const backend = path.join(dir, 'examify-backend');
  await initFixtureRepo(frontend);
  await initFixtureRepo(backend);
  void options;
  return { workspace: dir, frontend, backend };
}

function loadProject(fixture: Fixture, overrides: Partial<ProjectConfig['repositories'][number]>[] = []): LoadedProject {
  const repos = [
    { id: 'frontend', path: 'examify', remote: 'origin', defaultBranch: 'main', worktree: true, required: true, role: 'product' as const, instructions: ['AGENTS.md'] },
    { id: 'backend', path: 'examify-backend', remote: 'origin', defaultBranch: 'main', worktree: true, required: true, role: 'product' as const, instructions: ['AGENTS.md'] },
    ...overrides,
  ];
  return { config: buildConfig(repos), workspace: fixture.workspace, configPath: path.join(fixture.workspace, 'gantry.yaml') };
}

describe('discoverGroups', () => {
  test('groups the primary checkouts and pairs branch-matching worktrees', async () => {
    const fixture = await createWorkspace({ backendRequired: true });
    const project = loadProject(fixture);
    await ensureWorktree({
      repoPath: fixture.frontend,
      repo: project.config.repositories[0]!,
      branch: 'codex/feat',
      worktreeRoot: path.join(fixture.workspace, '.worktrees'),
    });
    const groups = await discoverGroups(project);
    const primary = groups.find((group) => group.branchKey === '__primary__');
    assert.ok(primary, 'primary group exists');
    assert.equal(primary!.isPrimary, true);
    assert.ok(primary!.checkouts.some((checkout) => checkout.repositoryId === 'frontend' && checkout.isPrimary));

    const feature = groups.find((group) => group.branchKey === 'codex/feat');
    assert.ok(feature, 'feature group exists');
    const frontendCheckout = feature!.checkouts.find((checkout) => checkout.repositoryId === 'frontend');
    assert.ok(frontendCheckout && !frontendCheckout.isPrimary);
    // Required backend is missing from the branch: fallback to primary checkout.
    const backendCheckout = feature!.checkouts.find((checkout) => checkout.repositoryId === 'backend');
    assert.ok(backendCheckout, 'backend fallback present');
    assert.equal(backendCheckout!.isFallback, true);
    assert.equal(backendCheckout!.path, fixture.backend);
    assert.equal(feature!.branch, 'codex/feat');
  });

  test('optional repositories are never substituted from an unrelated checkout', async () => {
    const fixture = await createWorkspace({ backendRequired: false });
    // An optional product repository whose primary checkout exists but has no matching worktree.
    const project = loadProject(fixture, [
      { id: 'logic', path: 'examify-logic', worktree: true, required: false, role: 'product' },
    ]);
    const logic = path.join(fixture.workspace, 'examify-logic');
    await initFixtureRepo(logic);
    await ensureWorktree({
      repoPath: fixture.frontend,
      repo: project.config.repositories[0]!,
      branch: 'codex/solo',
      worktreeRoot: path.join(fixture.workspace, '.worktrees'),
    });
    const groups = await discoverGroups(project);
    const solo = groups.find((group) => group.branchKey === 'codex/solo');
    assert.ok(solo);
    assert.ok(!solo!.checkouts.some((checkout) => checkout.repositoryId === 'logic'), 'optional repo must not fall back');
    const backendCheckout = solo!.checkouts.find((checkout) => checkout.repositoryId === 'backend');
    assert.ok(backendCheckout?.isFallback, 'required repo still falls back');
  });

  test('branch-matching worktrees pair across repositories without fallback', async () => {
    const fixture = await createWorkspace({ backendRequired: true });
    const project = loadProject(fixture);
    const worktreeRoot = path.join(fixture.workspace, '.worktrees');
    await ensureWorktree({ repoPath: fixture.frontend, repo: project.config.repositories[0]!, branch: 'codex/pair', worktreeRoot });
    await ensureWorktree({ repoPath: fixture.backend, repo: project.config.repositories[1]!, branch: 'codex/pair', worktreeRoot });
    const groups = await discoverGroups(project);
    const pair = groups.find((group) => group.branchKey === 'codex/pair');
    assert.ok(pair);
    assert.ok(pair!.checkouts.every((checkout) => !checkout.isFallback));
    assert.equal(pair!.checkouts.length, 2);
  });
});

describe('matchPull', () => {
  const refs: PullRef[] = [
    { number: 5, head: 'aaa', merge: null },
    { number: 7, head: 'bbb', merge: 'ccc' },
  ];

  test('a fresh branch at the default head never inherits an older PR', () => {
    const matched = matchPull({ head: 'aaa' }, refs, null, 'aaa');
    assert.equal(matched, undefined);
  });

  test('exact head match wins', () => {
    assert.equal(matchPull({ head: 'bbb' }, refs, null, 'aaa')?.number, 7);
  });

  test('a branch starting at the default head can still match its own PR', () => {
    assert.equal(matchPull({ head: 'aaa' }, refs, null, 'zzz')?.number, 5);
  });

  test('previous number is the fallback when the head moved', () => {
    assert.equal(matchPull({ head: 'moved' }, refs, 7, 'aaa')?.number, 7);
  });
});

describe('shouldRetire', () => {
  test('retires when every changed checkout has evidence', () => {
    assert.equal(
      shouldRetire([
        { isPrimary: true, isFallback: false, evidence: null },
        { isPrimary: false, isFallback: false, evidence: 'Merged' },
        { isPrimary: false, isFallback: true, evidence: null },
      ]),
      true,
    );
  });

  test('unchanged companion branches do not block retirement', () => {
    assert.equal(
      shouldRetire([
        { isPrimary: false, isFallback: false, evidence: 'Unchanged companion branch' },
        { isPrimary: false, isFallback: false, evidence: 'Merged' },
      ]),
      true,
    );
  });

  test('never retires with a missing evidence or unchanged-only set', () => {
    assert.equal(
      shouldRetire([
        { isPrimary: false, isFallback: false, evidence: 'Unchanged companion branch' },
        { isPrimary: false, isFallback: false, evidence: null },
      ]),
      false,
    );
    assert.equal(shouldRetire([{ isPrimary: true, isFallback: true, evidence: 'Merged' }]), false);
    assert.equal(shouldRetire([]), false);
  });
});

describe('mergedEvidence (fast-forward merge)', () => {
  test('detects a feature head included in the remote default branch', async () => {
    const { dir, cleanup } = await tempDir('gantry-evidence-');
    cleanups.push(cleanup);
    const repo = path.join(dir, 'examify');
    await initFixtureRepo(repo);

    // Feature worktree with a commit.
    await git(repo, 'worktree', 'add', '-b', 'codex/ff', path.join(dir, 'wt'), 'HEAD');
    const wt = path.join(dir, 'wt');
    await write(path.join(wt, 'feature.txt'), 'feature change\n');
    await git(wt, 'add', '.');
    await git(wt, 'commit', '-m', 'feature change');
    const featureHead = await git(wt, 'rev-parse', 'HEAD');

    // Fast-forward merge into main in the "remote" (the self-remote sees the
    // branch through update-ref, so simulate integration by moving main in
    // the primary checkout, which already holds main, and refreshing origin/main).
    await git(repo, 'merge', '--ff-only', 'codex/ff');
    await git(repo, 'update-ref', 'refs/remotes/origin/main', await git(repo, 'rev-parse', 'main'));
    const defaultHead = await git(repo, 'rev-parse', 'refs/remotes/origin/main');
    assert.equal(defaultHead, featureHead, 'setup: remote default contains the feature head');

    const pr: PullRef = { number: 12, head: featureHead, merge: null };
    const evidence = await mergedEvidence(repo, { head: featureHead }, pr, defaultHead, [pr]);
    assert.equal(evidence, 'PR head is included in the remote default branch');
  });

  test('returns null when the head is not integrated', async () => {
    const { dir, cleanup } = await tempDir('gantry-evidence2-');
    cleanups.push(cleanup);
    const repo = path.join(dir, 'examify');
    await initFixtureRepo(repo);
    // A commit that never reached main.
    await git(repo, 'commit', '--allow-empty', '-m', 'orphan work');
    const orphanHead = await git(repo, 'rev-parse', 'HEAD');
    const defaultHead = await git(repo, 'rev-parse', 'refs/remotes/origin/main');
    const pr: PullRef = { number: 3, head: orphanHead, merge: null };
    const evidence = await mergedEvidence(repo, { head: orphanHead }, pr, defaultHead, [pr]);
    assert.equal(evidence, null);
  });

  test('squash merges are detected by patch identity', async () => {
    const { dir, cleanup } = await tempDir('gantry-evidence3-');
    cleanups.push(cleanup);
    const repo = path.join(dir, 'examify');
    await initFixtureRepo(repo);

    await git(repo, 'worktree', 'add', '-b', 'codex/squash', path.join(dir, 'wt'), 'HEAD');
    const wt = path.join(dir, 'wt');
    await write(path.join(wt, 'thing.txt'), 'squashed content\n');
    await git(wt, 'add', '.');
    await git(wt, 'commit', '-m', 'original commit message');
    const featureHead = await git(wt, 'rev-parse', 'HEAD');

    // Squash into main with a DIFFERENT commit message and no ancestry.
    await git(wt, 'checkout', '--detach', 'refs/remotes/origin/main');
    await write(path.join(wt, 'thing.txt'), 'squashed content\n');
    await git(wt, 'add', '.');
    await git(wt, 'commit', '-m', 'custom squash message (#21)');
    const squashHead = await git(wt, 'rev-parse', 'HEAD');
    await git(repo, 'update-ref', 'refs/remotes/origin/main', squashHead);

    const pr: PullRef = { number: 21, head: featureHead, merge: null };
    const evidence = await mergedEvidence(repo, { head: featureHead }, pr, squashHead, [pr]);
    assert.match(evidence ?? '', /squash merge|equivalent patches/);
  });
});
