import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { stringify } from 'yaml';
import { findConfigFile } from './registry.js';
import { git } from '../git/git.js';

/** Discover a single repository or immediate child repositories. No services run by default. */
export async function initializeWorkspace(input: string) {
  const workspace = await fs.realpath(path.resolve(input));
  if (await findConfigFile(workspace)) return;
  const roots: string[] = [];
  const isRoot = async (dir: string) => fs.stat(path.join(dir, '.git')).then(() => true, () => false);
  if (await isRoot(workspace)) roots.push(workspace);
  else for (const entry of await fs.readdir(workspace, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules' && await isRoot(path.join(workspace, entry.name))) roots.push(path.join(workspace, entry.name));
  }
  if (!roots.length) throw new Error('No Git repositories found. Choose a repository folder or a folder containing repositories.');
  const slug = (name: string) => `repo-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')}`;
  const repositories = [];
  for (const [index, root] of roots.entries()) {
    let defaultBranch = 'main';
    try { defaultBranch = (await git(root, 'symbolic-ref', 'refs/remotes/origin/HEAD')).replace('refs/remotes/origin/', ''); }
    catch { try { defaultBranch = await git(root, 'branch', '--show-current') || 'main'; } catch { /* config validation reports invalid repos */ } }
    repositories.push({ id: `${slug(path.basename(root))}-${index + 1}`, path: path.relative(workspace, root) || '.', defaultBranch });
    // Personal config and worktrees must stay out of the connected repository.
    const exclude = await git(root, 'rev-parse', '--git-path', 'info/exclude');
    await fs.appendFile(path.resolve(root, exclude), '\n/gantry.yaml\n/.worktrees/\n', { mode: 0o600 });
  }
  await fs.writeFile(path.join(workspace, 'gantry.yaml'), stringify({ apiVersion: 'gantry.dev/v1', project: { id: `${slug(path.basename(workspace))}-${createHash('sha256').update(workspace).digest('hex').slice(0, 8)}`, name: path.basename(workspace) }, repositories, services: [] }), { flag: 'wx', mode: 0o600 });
}
