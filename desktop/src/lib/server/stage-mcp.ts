import 'server-only';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HOME, git } from './exec';

/**
 * Stage sessions run inside Gantry's worktree folders, so MCP servers you added to Claude Code
 * for the original repository folders (local/project scope in ~/.claude.json) would not load.
 * Collect those servers for each checkout's source repository and its parent folders, and hand
 * them to the stage with --mcp-config. User-scope servers already load everywhere.
 */
type Servers = Record<string, unknown>;

function claudeConfig(): { projects?: Record<string, { mcpServers?: Servers; disabledMcpServers?: string[] }> } | null {
  const dir = process.env.CLAUDE_CONFIG_DIR;
  const file = dir ? path.join(dir, '.claude.json') : path.join(os.homedir(), '.claude.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

const isWithin = (parent: string, child: string) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);

/** Source repository folder of a worktree (the folder holding the shared .git). */
async function sourceRepository(checkout: string): Promise<string | null> {
  try {
    const common = (await git(checkout, 'rev-parse', '--path-format=absolute', '--git-common-dir')).trim();
    return fs.realpathSync(path.dirname(common));
  } catch {
    return null;
  }
}

/** Path to a private MCP config for this ticket's stages, or undefined when there is nothing to add. */
export async function stageMcpConfig(ticketId: string, checkouts: string[]): Promise<string | undefined> {
  const config = claudeConfig();
  if (!config?.projects) return undefined;
  const repos = (await Promise.all(checkouts.map(sourceRepository))).filter((r): r is string => !!r);
  const servers: Servers = {};
  // Broader folders first so a repository's own entry wins on a name clash.
  const entries = Object.entries(config.projects).sort(([a], [b]) => a.length - b.length);
  for (const [folder, project] of entries) {
    if (!repos.some((repo) => isWithin(folder, repo))) continue;
    for (const [name, server] of Object.entries(project.mcpServers ?? {})) {
      if (project.disabledMcpServers?.includes(name)) continue;
      servers[name] = server;
    }
  }
  if (!Object.keys(servers).length) return undefined;
  const dir = path.join(HOME, 'mcp');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${ticketId.replace(/[^\w-]/g, '')}.json`);
  // Server definitions can carry tokens, so the file stays private to this user.
  fs.writeFileSync(file, JSON.stringify({ mcpServers: servers }, null, 1), { mode: 0o600 });
  return file;
}
