#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs/promises';
import { openDatabase } from '@gantry/server/db/db.js';
import { createAppContext } from '@gantry/server/config/app.js';
import { GantryApp } from '@gantry/server/app.js';
import { importLegacyWorkspace } from '@gantry/server/importer/legacy.js';

/**
 * `gantry` — the command line. The dashboard is the primary interface; the
 * CLI covers server lifecycle, workspace registration, first-run scaffolding
 * and legacy imports.
 */

interface Args {
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        index += 1;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(token);
    }
  }
  return { positional, flags };
}

const HELP = `gantry — local development control plane for tickets, worktrees, previews, and AI agents

Usage:
  gantry serve                          Start the dashboard (default: http://127.0.0.1:4500)
  gantry add <workspace>                Register a workspace containing gantry.yaml
  gantry init [dir]                     Scaffold a starter gantry.yaml
  gantry import-legacy <workspace>      Import the legacy preview manager's state
      --state-dir <dir>                 Legacy state directory (default: <workspace>/.local/previews)
      --dry-run                         Validate and report without writing
  gantry workflow <ticket> [step state] Report graph progress (--message details)
  gantry status [branch]                Print status from a running dashboard
  gantry open [branch]                  Open the dashboard (or a preview) in a browser
  gantry help                           Show this help

Environment:
  GANTRY_PORT (4500), GANTRY_HOST (127.0.0.1), GANTRY_DATA_DIR, GANTRY_UI_DIR,
  GANTRY_CODEX_BINARY, GANTRY_DEV_ORIGINS (comma-separated http origins for UI dev)`;

async function cmdServe(): Promise<void> {
  const app = new GantryApp();
  const running = await app.serve();
  app.log.info(`Gantry dashboard: http://127.0.0.1:${running.port}`);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void (async () => {
        await running.close();
        process.exit(0);
      })();
    });
  }
}

async function cmdAdd(workspace: string): Promise<void> {
  // Light path: load + register only. Supervision belongs to the running
  // server; a second supervisor on the same database would fight it.
  const { loadProject, registerProjectRow } = await import('@gantry/server/projects/registry.js');
  const ctx = createAppContext();
  const db = openDatabase(ctx.dbFile);
  try {
    const project = await loadProject(workspace);
    registerProjectRow(db, project);
    console.log(`Registered ${project.config.project.name} (${project.config.project.id})`);
    console.log(`Repositories: ${project.config.repositories.map((repo) => repo.id).join(', ')}`);
  } finally {
    db.close();
  }
}

async function cmdInit(dir?: string): Promise<void> {
  const target = path.resolve(dir ?? process.cwd());
  const file = path.join(target, 'gantry.yaml');
  if (await fs.stat(file).then(
    () => true,
    () => false,
  )) {
    console.error(`${file} already exists`);
    process.exitCode = 1;
    return;
  }
  await fs.writeFile(file, STARTER_YAML, { mode: 0o600 });
  console.log(`Wrote ${file}. Edit it to match your repositories and services, then run: gantry add ${target}`);
}

async function cmdImportLegacy(workspace: string, flags: Args['flags']): Promise<void> {
  const resolvedWorkspace = path.resolve(workspace);
  const stateDir = typeof flags['state-dir'] === 'string' ? flags['state-dir'] : path.join(resolvedWorkspace, '.local', 'previews');
  const dryRun = Boolean(flags['dry-run']);
  const ctx = createAppContext();
  const db = dryRun ? undefined : openDatabase(ctx.dbFile);
  const report = await importLegacyWorkspace({ workspace: resolvedWorkspace, stateDir, dryRun }, db);
  db?.close();
  console.log(JSON.stringify(report, null, 2));
  if (!dryRun) {
    console.log('\nNext steps:');
    console.log(`  gantry add ${resolvedWorkspace}`);
    console.log('  gantry serve');
  }
}

async function api(port: number, route: string, method: 'GET' | 'POST' = 'GET', input?: unknown): Promise<unknown> {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method,
    headers: { Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/json' },
    body: input === undefined ? undefined : JSON.stringify(input),
    signal: AbortSignal.timeout(5000),
  });
  const body = (await response.json()) as { error?: string };
  if (!response.ok) throw Object.assign(new Error(body.error ?? `Request failed (${response.status})`), { statusCode: response.status });
  return body;
}

async function cmdStatus(branch?: string, port = 4500): Promise<void> {
  const status = (await api(port, '/api/status')) as { previews: { id: string; branch: string; status: string; services: { id: string; state: string; port: number | null }[] }[] };
  const previews = branch ? status.previews.filter((preview) => preview.branch === branch || preview.id === branch) : status.previews;
  for (const preview of previews) {
    const services = preview.services.map((service) => `${service.id}:${service.state}${service.port ? `:${service.port}` : ''}`).join(' ');
    console.log(`${preview.branch.padEnd(40)} ${preview.status.padEnd(16)} ${services}`);
  }
  if (!previews.length) console.log('No previews match.');
}

async function cmdOpen(branch: string | undefined, port = 4500): Promise<void> {
  const { spawn } = await import('node:child_process');
  let url = `http://127.0.0.1:${port}`;
  if (branch) {
    const status = (await api(port, '/api/status')) as { previews: { id: string; branch: string; services: { id: string; openLink: string | null }[] }[] };
    const preview = status.previews.find((candidate) => candidate.branch === branch || candidate.id === branch);
    if (!preview) throw new Error(`No preview named ${branch}`);
    url = preview.services.find((service) => service.id === 'frontend')?.openLink ?? url;
  }
  const child = spawn(process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open', process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url], { stdio: 'ignore', detached: true });
  child.unref();
  console.log(url);
}

async function main(): Promise<void> {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [verb, argument] = positional;
  try {
    switch (verb ?? 'serve') {
      case 'serve':
        await cmdServe();
        break;
      case 'add':
        if (!argument) throw new Error('Usage: gantry add <workspace>');
        await cmdAdd(argument);
        break;
      case 'init':
        await cmdInit(argument);
        break;
      case 'import-legacy':
        if (!argument) throw new Error('Usage: gantry import-legacy <workspace> --state-dir <dir>');
        await cmdImportLegacy(argument, flags);
        break;
      case 'workflow': {
        const port = Number(flags['port'] ?? process.env.GANTRY_PORT ?? 4500);
        const [, ticketId, nodeId, state] = positional;
        if (!ticketId || !/^[\w-]+$/.test(ticketId)) throw new Error('Provide a ticket ID.');
        const route = `/api/tickets/${ticketId}/workflow`;
        for (let attempt = 0; attempt < 5; attempt++) {
          const current = await api(port, route) as { revision: number } | null;
          if (!nodeId) { console.log(JSON.stringify(current, null, 2)); break; }
          if (!current) throw new Error('This ticket has no graph.');
          try {
            console.log(JSON.stringify(await api(port, `${route}-progress`, 'POST', { nodeId, state, revision: current.revision, message: flags['message'] || '' }), null, 2));
            break;
          } catch (error) {
            if ((error as { statusCode?: number }).statusCode !== 409 || attempt === 4) throw error;
          }
        }
        break;
      }
      case 'status':
        await cmdStatus(argument, Number(flags['port'] ?? 4500));
        break;
      case 'open':
        await cmdOpen(argument, Number(flags['port'] ?? 4500));
        break;
      case 'help':
      case '--help':
      case '-h':
        console.log(HELP);
        break;
      default:
        throw new Error(`Unknown command "${verb}".\n${HELP}`);
    }
  } catch (error) {
    console.error(`gantry: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}

const STARTER_YAML = `apiVersion: gantry.dev/v1

project:
  id: my-project
  name: My Project
  defaultAgent: codex
  defaultPromptTemplate: builtin:default
  branchPrefix: ticket
  worktreeRoot: .worktrees
  portBase: 5200

repositories:
  - id: frontend
    path: frontend          # relative to this workspace
    remote: origin
    defaultBranch: main
    worktree: true
    required: true
  - id: backend
    path: backend
    remote: origin
    defaultBranch: main
    worktree: true
    required: true

services:
  - id: frontend
    repository: frontend
    runtime: command
    install: npm ci --no-audit --no-fund
    start: npm run dev -- --host 127.0.0.1 --port \${port}
    healthUrl: http://127.0.0.1:\${port}/
    openUrl: http://127.0.0.1:\${port}/
    dependsOn: [backend]
    envFiles: [.env, .env.local]
  - id: backend
    repository: backend
    runtime: command
    install: npm ci --no-audit --no-fund
    start: npm run dev
    env:
      PORT: \${port}
    envFiles: [.env, .env.local]

# Environments reference PRIVATE env files (never commit their contents):
# environments:
#   - id: production
#     label: Production
#     default: true
#     envFiles:
#       frontend: .local/gantry/environments/production/frontend.env
#       backend: .local/gantry/environments/production/backend.env
`;

await main();
