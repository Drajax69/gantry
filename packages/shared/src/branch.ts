/**
 * Branch naming. Branches come from ticket titles (untrusted input), so the
 * slug is aggressively normalized and the final name re-validated with the
 * same rules Git enforces via `git check-ref-format`.
 */

const BRANCH_RE = /^(?!.*\.\.)(?!.*\/$)(?!.*\/\.)(?!.*\.lock$)[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export function isValidBranchName(branch: string): boolean {
  return branch.length > 0 && branch.length <= 200 && BRANCH_RE.test(branch);
}

export function slugFor(title: string): string {
  return String(title || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 54)
    .replace(/-+$/g, '');
}

/** Derive a ticket branch from a title, honoring the project's prefix. */
export function branchFor(title: string, prefix = 'ticket'): string {
  const slug = slugFor(title) || 'ticket';
  return `${prefix}/${slug}`;
}

/** Folder name for a branch's worktree group: `codex/fix-x` -> `codex--fix-x`. */
export function worktreeFolderFor(branch: string): string {
  return branch.replaceAll('/', '--');
}
