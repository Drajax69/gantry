import { spawn } from 'node:child_process';
import { git, isAncestor } from '../git/git.js';
import type { PullRef } from './remote.js';

/**
 * Merge evidence: decide whether a branch's changes are present in the
 * remote default branch, supporting fast-forward, squash, rebase and
 * nested-squash merges by verifying patches rather than trusting PR numbers
 * in commit messages. Ported from the legacy manager, where this logic was
 * hardened over months of daily use.
 *
 * A missing `refs/pull/N/merge` is never evidence of a merge: closed and
 * conflicted PRs also lack it. A vanished remote branch alone never retires
 * a preview.
 */

function patchIdsIn(repoPath: string, patch: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['patch-id', '--stable'], { cwd: repoPath, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(output.trim().split('\n').map((line) => line.split(/\s/)[0]).filter((part): part is string => Boolean(part))) : reject(new Error('patch-id failed'))));
    child.stdin?.on('error', reject);
    child.stdin?.end(patch);
  });
}

async function directMergedEvidence(repoPath: string, head: string, pr: PullRef | null, base: string): Promise<string | null> {
  if (!pr || pr.head !== head) return null;
  if (await isAncestor(repoPath, head, base)) return 'PR head is included in the remote default branch';
  if (pr.merge) return null;
  // Squash / rebase merges: compare the complete feature patch against the
  // patches that reached the default branch.
  const fork = await git(repoPath, 'merge-base', head, base);
  const [aggregate] = await patchIdsIn(repoPath, await git(repoPath, 'diff', '--binary', fork, head));
  const integrated = await patchIdsIn(repoPath, await git(repoPath, 'log', '--no-merges', '--format=commit %H', '--binary', '-p', `${fork}..${base}`));
  if (aggregate && integrated.includes(aggregate)) return 'The complete PR patch is included in the remote default branch (squash merge)';
  const cherry = await git(repoPath, 'cherry', base, head, fork);
  if (cherry && cherry.split('\n').every((line) => line.startsWith('- '))) return 'All PR commits are present as equivalent patches';
  return null;
}

export async function mergedEvidence(
  repoPath: string,
  source: { head: string },
  pr: PullRef | null,
  base: string,
  pulls: PullRef[] = [],
): Promise<string | null> {
  const direct = await directMergedEvidence(repoPath, source.head, pr, base);
  if (direct || !pr || pr.head !== source.head || pr.merge) return direct;
  // A PR can be squash-merged into a feature branch which is then squashed
  // into the default branch. Both patch relationships must verify.
  for (const parent of [...pulls].sort((a, b) => b.number - a.number)) {
    if (parent.merge || parent.head === pr.head || !parent.head) continue;
    const exists = await git(repoPath, 'cat-file', '-e', `${parent.head}^{commit}`).then(
      () => true,
      () => false,
    );
    if (!exists) continue; // only inspect history already available locally
    if (!(await directMergedEvidence(repoPath, source.head, pr, parent.head))) continue;
    if (await directMergedEvidence(repoPath, parent.head, parent, base)) {
      return `PR changes are included through PR #${parent.number}, whose changes are integrated in the remote default branch`;
    }
  }
  return null;
}

/** Match a checkout head to a PR. A fresh branch at the default head never inherits an older PR. */
export function matchPull(source: { head: string }, refs: PullRef[], previousNumber: number | null, defaultHead: string | null): PullRef | undefined {
  if (!previousNumber && defaultHead && source.head === defaultHead) return undefined;
  const exact = refs.filter((pr) => pr.head === source.head).sort((a, b) => b.number - a.number)[0];
  if (exact) return exact;
  return previousNumber ? refs.find((pr) => pr.number === previousNumber) : undefined;
}

/** A preview is retired when every changed checkout has merge evidence. */
export function shouldRetire(checkouts: { isFallback: boolean; isPrimary: boolean; evidence: string | null }[]): boolean {
  const changed = checkouts.filter((checkout) => !checkout.isPrimary && !checkout.isFallback);
  return changed.length > 0 && changed.every((checkout) => Boolean(checkout.evidence)) && changed.some((checkout) => checkout.evidence !== 'Unchanged companion branch');
}
