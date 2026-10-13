import path from 'node:path';

/**
 * Path-safety helpers. Gantry drives Git, shells and agents, so every
 * filesystem path that originates from config, tickets or URLs is checked here.
 */

export class PathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathError';
  }
}

/** True when `child` is `parent` itself or lives underneath it (lexically). */
export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Resolve then require the result to stay inside `parent`. */
export function safeJoin(parent: string, ...segments: string[]): string {
  const resolved = path.resolve(parent, ...segments);
  if (!isInside(path.resolve(parent), resolved)) {
    throw new PathError(`Path escapes its allowed directory: ${segments.join('/')}`);
  }
  return resolved;
}

/**
 * Validate a repository or worktree path coming from config or a ticket:
 * it must be absolute (after joining to the workspace), must not traverse
 * outside the workspace, and must not contain NUL or newline characters.
 */
export function validateManagedPath(workspace: string, candidate: string): string {
  if (/[\0\r\n]/.test(candidate)) throw new PathError('Path contains control characters');
  const resolved = path.isAbsolute(candidate) ? path.normalize(candidate) : path.resolve(workspace, candidate);
  if (!isInside(workspace, resolved)) {
    throw new PathError(`Path is outside the workspace: ${candidate}`);
  }
  return resolved;
}

/** Strip a trailing separator so path equality checks behave. */
export function normalizeDir(dir: string): string {
  return dir.replace(/[\\/]+$/, '') || dir;
}
