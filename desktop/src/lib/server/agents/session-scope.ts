import path from 'node:path';

/** Legacy OpenCode sessions may belong to the app's launch directory. Never resume
 * one until Gantry has recorded the checkout in which it was actually created. */
export function scopedSessionId(kind: string, id: string | null | undefined, directory: string | undefined, cwd: string): string | null {
  if (!id) return null;
  if (kind === 'opencode' && (!directory || path.resolve(directory) !== path.resolve(cwd))) return null;
  return id;
}
