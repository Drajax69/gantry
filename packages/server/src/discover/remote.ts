import { run } from '../util/exec.js';
import { git, gitWithTimeout } from '../git/git.js';

/**
 * Slow-path remote synchronization: explicit fetches and GitHub PR listings.
 * This module is never invoked on the ticket-start path — starts rely on
 * fast, local discovery only, so a slow network cannot delay an agent.
 */

export interface PullRef {
  number: number;
  head: string | null;
  merge: string | null;
}

export function parsePullRefs(raw: string): PullRef[] {
  const refs = new Map<number, PullRef>();
  for (const line of raw.split('\n')) {
    const match = line.match(/^([a-f0-9]+)\s+refs\/pull\/(\d+)\/(head|merge)$/);
    if (!match) continue;
    const number = Number(match[2]);
    const ref = refs.get(number) ?? { number, head: null, merge: null };
    if (match[3] === 'head') ref.head = match[1]!;
    else ref.merge = match[1]!;
    refs.set(number, ref);
  }
  return [...refs.values()];
}

/** `owner/name` from a remote URL (SSH or HTTPS), or null for non-GitHub remotes. */
export function repositorySlugFromUrl(url: string): string | null {
  const match = url.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  return match?.[1] ?? null;
}

export interface RemoteSnapshot {
  repository: string;
  remote: string;
  defaultBranch: string;
  head: string | null;
  pullRefs: PullRef[];
  checkedAt: number;
  error: string | null;
  /** GitHub CLI availability (exact PR state checks), separate from Git access. */
  githubCli: boolean;
}

/**
 * Refresh one repository's remote view using Git only (the user's existing
 * authentication). Falls back to the last snapshot's data on failure.
 */
export async function syncRepository(previous: RemoteSnapshot | null, repoPath: string, remote: string, defaultBranch: string): Promise<RemoteSnapshot> {
  const base: RemoteSnapshot = previous ?? {
    repository: '',
    remote,
    defaultBranch,
    head: null,
    pullRefs: [],
    checkedAt: 0,
    error: null,
    githubCli: false,
  };
  try {
    const defaultRef = await git(repoPath, 'symbolic-ref', `refs/remotes/${remote}/HEAD`).catch(() => `refs/remotes/${remote}/${defaultBranch}`);
    // Refresh only the default branch ref: enough for merge evidence, cheap.
    await gitWithTimeout(repoPath, 20_000, 'fetch', '--no-tags', remote, `+refs/heads/${defaultBranch}:${defaultRef}`);
    const head = await git(repoPath, 'rev-parse', defaultRef);
    const pullRefs = parsePullRefs(await gitWithTimeout(repoPath, 20_000, 'ls-remote', remote, 'refs/pull/*/head', 'refs/pull/*/merge').catch(() => ''));
    const url = await git(repoPath, 'remote', 'get-url', remote);
    return {
      ...base,
      repository: repositorySlugFromUrl(url) ?? base.repository ?? '',
      head,
      pullRefs,
      checkedAt: Date.now(),
      error: null,
      githubCli: base.githubCli,
    };
  } catch (error) {
    return { ...base, error: `Could not refresh the remote over Git; using the last successful data (${(error as Error).message}).` };
  }
}

export interface OpenPull {
  number: number;
  title: string;
  url: string;
  branch: string;
  head: string;
  author: string | null;
  updatedAt: string;
  draft: boolean;
  mergeState: string;
  checks: 'passed' | 'pending' | 'failed' | 'unknown';
  ready: boolean;
  blockers: string[];
}

const FAILED_CONCLUSIONS = new Set(['ACTION_REQUIRED', 'CANCELLED', 'FAILURE', 'STARTUP_FAILURE', 'STALE', 'TIMED_OUT']);

export function checkState(checks: { status?: string; conclusion?: string }[]): 'passed' | 'pending' | 'failed' {
  if (checks.some((check) => FAILED_CONCLUSIONS.has(String(check.conclusion)))) return 'failed';
  if (checks.some((check) => check.status !== 'COMPLETED' && check.status !== 'SUCCESS')) return 'pending';
  return 'passed';
}

export function normalizePull(raw: Record<string, unknown>): OpenPull {
  const rollup = (raw.statusCheckRollup ?? []) as { status?: string; conclusion?: string }[];
  const checks = rollup.length ? checkState(rollup) : 'unknown';
  const blockers: string[] = [];
  if (raw.isDraft) blockers.push('Draft');
  const mergeState = String(raw.mergeStateStatus ?? 'UNKNOWN');
  if (mergeState !== 'CLEAN') blockers.push(`GitHub status: ${mergeState.toLowerCase()}`);
  if (checks === 'failed') blockers.push('Checks failed');
  if (checks === 'pending') blockers.push('Checks pending');
  return {
    number: Number(raw.number),
    title: String(raw.title ?? ''),
    url: String(raw.url ?? ''),
    branch: String(raw.headRefName ?? ''),
    head: String(raw.headRefOid ?? ''),
    author: (raw.author as { login?: string } | null)?.login ?? null,
    updatedAt: String(raw.updatedAt ?? ''),
    draft: Boolean(raw.isDraft),
    mergeState,
    checks,
    ready: blockers.length === 0,
    blockers,
  };
}

export async function githubCliAvailable(): Promise<boolean> {
  try {
    await run('gh', ['auth', 'status'], { timeoutMs: 5000 });
    return true;
  } catch {
    return false;
  }
}

export async function listOpenPulls(repository: string, cwd: string): Promise<OpenPull[]> {
  const output = await run(
    'gh',
    [
      'pr', 'list', '--repo', repository, '--state', 'open', '--limit', '100',
      '--json', 'number,title,url,headRefName,headRefOid,isDraft,mergeStateStatus,statusCheckRollup,author,updatedAt',
    ],
    { cwd, timeoutMs: 30_000 },
  );
  const pulls = JSON.parse(output || '[]') as Record<string, unknown>[];
  if (!Array.isArray(pulls)) throw new Error(`GitHub returned an invalid PR list for ${repository}`);
  return pulls.map(normalizePull);
}

/** Exact PR state via the GitHub CLI. Null when gh is unavailable or fails. */
export async function pullState(repository: string, number: number): Promise<{ merged: boolean; head: string; state: string } | null> {
  try {
    const raw = await run('gh', ['api', `repos/${repository}/pulls/${number}`, '--jq', '{merged: .merged, head: .head.sha, state: .state}'], { timeoutMs: 10_000 });
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
