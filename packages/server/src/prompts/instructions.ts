import fs from 'node:fs/promises';
import path from 'node:path';
import type { LoadedProject } from '../projects/registry.js';

/**
 * Repository instruction discovery: the workspace-level files plus each
 * repository's instruction files (AGENTS.md, CLAUDE.md by default), existing
 * on disk right now. Paths are listed in prompts; the agent reads them.
 */
export async function findInstructionFiles(project: LoadedProject): Promise<string[]> {
  const found: string[] = [];
  const check = async (file: string): Promise<void> => {
    try {
      const stat = await fs.stat(file);
      if (stat.isFile()) found.push(file);
    } catch {
      /* absent */
    }
  };
  for (const name of project.config.project.workspaceInstructions) {
    await check(path.join(project.workspace, name));
  }
  for (const repo of project.config.repositories) {
    for (const name of repo.instructions) {
      await check(path.resolve(project.workspace, repo.path, name));
    }
  }
  return [...new Set(found)];
}
