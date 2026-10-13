import { test, describe, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureWorktree, parseWorktrees, listWorktrees } from '../packages/server/src/git/worktrees.js';
import { initFixtureRepo, tempDir, write, git } from './helpers.js';

const cleanups: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup().catch(() => {});
});

async function fixtureRepo(prefix: string): Promise<string> {
  const { dir, cleanup } = await tempDir(prefix);
  cleanups.push(cleanup);
  const repo = path.join(dir, 'examify');
  await initFixtureRepo(repo);
  return repo;
}

const repoConfig = { id: 'frontend', path: '.', remote: 'origin', defaultBranch: 'main', worktree: true, required: true, role: 'product' as const, instructions: ['AGENTS.md'] };

describe('ensureWorktree', () => {
  test('creates a new branch worktree from the remote default branch', async () => {
    const repo = await fixtureRepo('gantry-wt-create-');
    const worktreeRoot = path.join(path.dirname(repo), '.worktrees');
    const result = await ensureWorktree({ repoPath: repo, repo: repoConfig, branch: 'codex/fresh', worktreeRoot });
    assert.equal(result.reused, false);
    const expected = path.join(worktreeRoot, 'codex--fresh', 'examify');
    assert.equal(result.path, expected);
    const stat = await fs.stat(expected);
    assert.ok(stat.isDirectory());
    const head = await git(expected, 'rev-parse', 'HEAD');
    assert.equal(result.head, head);
  });

  test('reuses an existing worktree for the same branch wherever it lives', async () => {
    const repo = await fixtureRepo('gantry-wt-reuse-');
    const customRoot = path.join(path.dirname(repo), 'custom-place');
    const first = await ensureWorktree({ repoPath: repo, repo: repoConfig, branch: 'codex/exists', worktreeRoot: customRoot });
    const second = await ensureWorktree({ repoPath: repo, repo: repoConfig, branch: 'codex/exists', worktreeRoot: path.join(path.dirname(repo), '.worktrees') });
    assert.equal(second.reused, true);
    assert.equal(second.path, first.path);
  });

  test('reuses an existing local branch without recreating or resetting it', async () => {
    const repo = await fixtureRepo('gantry-wt-localbranch-');
    // Create a local branch (no worktree yet) with an extra commit.
    await git(repo, 'branch', 'codex/local-only');
    await git(repo, 'update-ref', 'refs/heads/codex/local-only', 'HEAD');
    const result = await ensureWorktree({ repoPath: repo, repo: repoConfig, branch: 'codex/local-only', worktreeRoot: path.join(path.dirname(repo), '.worktrees') });
    assert.equal(result.reused, false);
    const head = await git(result.path, 'rev-parse', 'HEAD');
    const branchHead = await git(repo, 'rev-parse', 'refs/heads/codex/local-only');
    assert.equal(head, branchHead);
    // Idempotent: second call reuses the worktree.
    const again = await ensureWorktree({ repoPath: repo, repo: repoConfig, branch: 'codex/local-only', worktreeRoot: path.join(path.dirname(repo), '.worktrees') });
    assert.equal(again.reused, true);
  });

  test('creates from the remote branch when it exists on origin', async () => {
    const repo = await fixtureRepo('gantry-wt-remote-');
    // Publish a branch into the self-remote without a local worktree.
    await git(repo, 'branch', 'codex/remote-branch');
    await git(repo, 'push', repo, 'refs/heads/codex/remote-branch:refs/heads/codex/remote-branch').catch(async () => {
      // Pushing to the same repository path can refuse for the checked-out branch only;
      // update-ref directly into the remote namespace instead.
      await git(repo, 'update-ref', 'refs/remotes/origin/codex/remote-branch', await git(repo, 'rev-parse', 'refs/heads/codex/remote-branch'));
    });
    const result = await ensureWorktree({ repoPath: repo, repo: repoConfig, branch: 'codex/remote-branch', worktreeRoot: path.join(path.dirname(repo), '.worktrees') });
    assert.equal(result.reused, false);
    const head = await git(result.path, 'rev-parse', 'HEAD');
    assert.equal(head, await git(repo, 'rev-parse', 'refs/heads/codex/remote-branch'));
  });

  test('refuses when the destination exists but is not a registered worktree', async () => {
    const repo = await fixtureRepo('gantry-wt-collide-');
    const worktreeRoot = path.join(path.dirname(repo), '.worktrees');
    await write(path.join(worktreeRoot, 'codex--crash', 'examify', 'leftover.txt'), 'not a worktree');
    await assert.rejects(
      () => ensureWorktree({ repoPath: repo, repo: repoConfig, branch: 'codex/crash', worktreeRoot }),
      /already exists/,
    );
  });

  test('dirty worktrees are reused and never modified', async () => {
    const repo = await fixtureRepo('gantry-wt-dirty-');
    const worktreeRoot = path.join(path.dirname(repo), '.worktrees');
    const first = await ensureWorktree({ repoPath: repo, repo: repoConfig, branch: 'codex/dirty', worktreeRoot });
    await write(path.join(first.path, 'README.md'), 'local uncommitted edit\n');
    const second = await ensureWorktree({ repoPath: repo, repo: repoConfig, branch: 'codex/dirty', worktreeRoot });
    assert.equal(second.reused, true);
    const contents = await fs.readFile(path.join(first.path, 'README.md'), 'utf8');
    assert.equal(contents, 'local uncommitted edit\n');
    const status = await git(first.path, 'status', '--porcelain');
    assert.match(status, /M README\.md/);
  });
});

describe('parseWorktrees', () => {
  test('parses porcelain -z output with spaces, detached heads and prunable entries', () => {
    const raw =
      'worktree /with spaces/a\0HEAD aaaa\0branch refs/heads/feature\0\0' +
      'worktree /other/b\0HEAD bbbb\0detached\0\0' +
      'worktree /gone\0HEAD cccc\0prunable missing\0\0';
    const parsed = parseWorktrees(raw);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0]!.path, '/with spaces/a');
    assert.equal(parsed[0]!.branch, 'feature');
    assert.equal(parsed[0]!.head, 'aaaa');
    assert.equal(parsed[1]!.branch, null);
    assert.equal(parsed[1]!.prunable, false);
  });

  test('listWorktrees reads a real repository including the main checkout', async () => {
    const repo = await fixtureRepo('gantry-wt-list-');
    await ensureWorktree({ repoPath: repo, repo: repoConfig, branch: 'codex/listed', worktreeRoot: path.join(path.dirname(repo), '.worktrees') });
    const trees = await listWorktrees(repo);
    assert.equal(trees.length, 2);
    assert.ok(trees.some((tree) => tree.branch === 'main'));
    assert.ok(trees.some((tree) => tree.branch === 'codex/listed'));
  });
});
