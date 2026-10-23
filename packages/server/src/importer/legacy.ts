import fs from 'node:fs/promises';
import path from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { idFor } from '@gantry/shared';
import { parseProjectConfig, type ProjectConfig } from '@gantry/shared';
import type { Database } from '../db/db.js';
import { previewIdFor } from '../git/worktrees.js';

/**
 * Importer for the legacy single-workspace preview manager.
 *
 * Reads the legacy state directory (state.json, config.json, tickets.json,
 * profiles/) plus the workspace layout, and produces:
 *   - a complete `gantry.yaml` (repositories, services, environments, the
 *     Paper Setter legacy prompt preset selected by default)
 *   - ticket rows preserving titles, notes, scopes, branches, status,
 *     ordering, and agent session ids where present
 *   - preview preferences (paused/archived/profile/port sticks)
 *   - a migration report: what moved, what needs attention, how to roll back
 *
 * Deliberately NOT imported:
 *  - stale PIDs: never recorded as running; the supervisor verifies real
 *    process ownership on startup and adopts only processes it can prove.
 *  - secrets: environment files stay where they are; the generated config
 *    references their existing private paths (never their contents).
 *  - evidence artifacts, logs, preview-login credentials: left in place.
 */

export interface LegacyImportInput {
  workspace: string;
  /** The legacy manager's state directory (contains state.json, tickets.json…). */
  stateDir: string;
  /** Dry run: validate and report without writing anything. */
  dryRun?: boolean;
}

export interface MigrationReport {
  workspace: string;
  configFile: string | null;
  dryRun: boolean;
  imported: {
    tickets: number;
    ticketsWithSessions: number;
    previewPreferences: number;
    previewsImportedPaused?: boolean;
    environments: string[];
    repositories: string[];
    services: string[];
    promptTemplate: string;
  };
  attention: string[];
  skipped: string[];
  rollback: string;
}

export async function importLegacyWorkspace(input: LegacyImportInput, db?: Database): Promise<MigrationReport> {
  const workspace = path.resolve(input.workspace);
  const stateDir = path.resolve(input.stateDir);
  const attention: string[] = [];
  const skipped: string[] = [];

  const readJson = async <T>(file: string, fallback: T): Promise<T> => {
    try {
      return JSON.parse(await fs.readFile(path.join(stateDir, file), 'utf8')) as T;
    } catch {
      return fallback;
    }
  };

  // ---- discover the workspace layout --------------------------------------
  const entries = await fs.readdir(workspace, { withFileTypes: true }).catch(() => []);
  const directories = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.')).map((entry) => entry.name);
  const pick = (...names: string[]): string | null => directories.find((directory) => names.includes(directory)) ?? null;
  const frontendRepo = pick('examify', 'frontend', 'web');
  const backendRepo = pick('examify-backend', 'backend', 'api');
  const e2eRepo = pick('examify-e2e', 'e2e', 'tests');
  const logicRepo = pick('examify-logic', 'logic');
  const documentRepo = pick('examify-document-service', 'document-service', 'document');
  if (!frontendRepo) throw new Error(`Could not find the frontend repository in ${workspace} (looked for examify/)`);
  if (!backendRepo) throw new Error(`Could not find the backend repository in ${workspace} (looked for examify-backend/)`);

  const instructions = ['AGENTS.md', 'CLAUDE.md'];
  const repositories: ProjectConfig['repositories'] = [
    { id: 'frontend', path: frontendRepo, remote: 'origin', defaultBranch: 'main', worktree: true, required: true, role: 'product', instructions },
    { id: 'backend', path: backendRepo, remote: 'origin', defaultBranch: 'main', worktree: true, required: true, role: 'product', instructions },
  ];
  if (e2eRepo) {
    repositories.push({ id: 'e2e', path: e2eRepo, remote: 'origin', defaultBranch: 'main', worktree: false, required: false, role: 'tooling', instructions });
  } else {
    attention.push('No E2E harness directory found; the legacy prompt references one. Add a tooling repository for it in gantry.yaml.');
  }
  if (logicRepo) repositories.push({ id: 'logic', path: logicRepo, remote: 'origin', defaultBranch: 'main', worktree: true, required: false, role: 'product', instructions });
  if (documentRepo) repositories.push({ id: 'document', path: documentRepo, remote: 'origin', defaultBranch: 'main', worktree: true, required: false, role: 'product', instructions });

  // Managed runtimes drive start themselves; `start` is only required for
  // runtime: command services.
  const services: ProjectConfig['services'] = [
    {
      id: 'frontend',
      repository: 'frontend',
      runtime: 'vite',
      install: { kind: 'shell', value: 'npm ci --no-audit --no-fund' },
      healthUrl: 'http://127.0.0.1:${port}/',
      openUrl: 'http://127.0.0.1:${port}/',
      dependsOn: ['backend'],
      env: { VITE_BACKEND_URL: '${origin.backend}' },
      envFiles: ['.env', '.env.local', '.env.preview.local'],
      workDir: '.',
      hooks: { preStart: [], postStart: [] },
      platform: {},
      banner: { enabled: true, autoLogin: false },
      entry: 'src/services/preview-login.ts',
    },
    {
      id: 'backend',
      repository: 'backend',
      runtime: 'node',
      install: { kind: 'shell', value: 'npm ci --no-audit --no-fund' },
      healthUrl: 'http://127.0.0.1:${port}/api-docs/',
      openUrl: 'http://127.0.0.1:${port}/api-docs/',
      dependsOn: [],
      env: {},
      envFiles: ['.env', '.env.local', '.env.preview.local'],
      workDir: '.',
      hooks: { preStart: [], postStart: [] },
      platform: {},
      entry: 'src/app.ts',
    },
  ];
  if (logicRepo) {
    services.push({
      id: 'logic',
      repository: 'logic',
      runtime: 'python',
      healthUrl: 'http://127.0.0.1:${port}/health',
      openUrl: 'http://127.0.0.1:${port}/health',
      dependsOn: [],
      env: {},
      envFiles: ['.env', '.env.local', '.env.preview.local'],
      workDir: '.',
      hooks: { preStart: [], postStart: [] },
      platform: {},
      entry: 'app',
    });
    services.find((service) => service.id === 'backend')!.dependsOn = ['logic'];
  }
  if (documentRepo) {
    services.push({
      id: 'document',
      repository: 'document',
      runtime: 'python',
      healthUrl: 'http://127.0.0.1:${port}/health',
      openUrl: 'http://127.0.0.1:${port}/health',
      dependsOn: [],
      env: {},
      envFiles: ['.env', '.env.local', '.env.preview.local'],
      workDir: '.',
      hooks: { preStart: [], postStart: [] },
      platform: {},
      entry: 'render_api',
    });
  }

  // ---- environments (private profile files, referenced in place) ----------
  const legacyProfilesDir = path.join(stateDir, 'profiles');
  const environments: ProjectConfig['environments'] = [];
  const profileEntries = await fs.readdir(legacyProfilesDir, { withFileTypes: true }).catch(() => []);
  for (const entry of profileEntries.filter((candidate) => candidate.isDirectory())) {
    const relativeDir = path.relative(workspace, path.join(legacyProfilesDir, entry.name));
    const envFiles: Record<string, string> = {};
    for (const serviceId of ['frontend', 'backend']) {
      if (await hasFile(path.join(legacyProfilesDir, entry.name, `${serviceId}.env`))) {
        envFiles[serviceId] = path.join(relativeDir, `${serviceId}.env`);
      }
    }
    if (Object.keys(envFiles).length === 0) {
      attention.push(`Profile "${entry.name}" has no env files; skipped.`);
      continue;
    }
    environments.push({
      id: entry.name,
      label: entry.name === 'papersetter' ? 'Paper Setter' : entry.name === 'xamify' ? 'Xamify' : entry.name,
      default: entry.name === 'papersetter',
      envFiles,
      env: {},
      requireKeys: {},
    });
  }
  if (!environments.length) {
    attention.push('No legacy environment profiles found; previews will run without private environment files until you configure environments.');
  }

  const config: ProjectConfig = {
    apiVersion: 'gantry.dev/v1',
    project: {
      id: 'papersetter',
      name: 'Paper Setter',
      defaultAgent: 'codex',
      defaultPromptTemplate: 'builtin:paper-setter-legacy',
      branchPrefix: 'codex',
      worktreeRoot: '.worktrees',
      portBase: 5200,
      portRange: 1000,
      workspaceInstructions: ['AGENTS.md', 'CLAUDE.md'],
    },
    repositories,
    services,
    environments,
    promptTemplates: [],
    workflowTemplates: [],
    scopes: [],
    agents: [],
    safety: { testRecordPrefix: 'TEST_', manualTestFile: 'manual-test-needed.md', policy: undefined },
  };

  const validation = parseProjectConfig(structuredCloneSafe(config));
  if (!validation.ok) throw new Error(`Generated config failed validation:\n${validation.errors.join('\n')}`);

  const configFile = path.join(workspace, 'gantry.yaml');
  let wroteConfig = false;
  if (!input.dryRun) {
    if (await hasFile(configFile)) {
      skipped.push('A gantry.yaml already exists; it was left untouched.');
    } else {
      await fs.writeFile(configFile, buildYaml(config), { mode: 0o600 });
      wroteConfig = true;
    }
  }

  // ---- tickets ------------------------------------------------------------
  const legacyTickets = await readJson<{ tickets: LegacyTicket[] }>('tickets.json', { tickets: [] });
  let ticketsWithSessions = 0;
  const now = new Date().toISOString();
  if (db && !input.dryRun) {
    // The generated project row must exist before tickets reference it.
    db.prepare(
      `INSERT INTO projects (id, name, workspace, config_path, default_agent, default_prompt_template, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, workspace=excluded.workspace, config_path=excluded.config_path,
         default_agent=excluded.default_agent, default_prompt_template=excluded.default_prompt_template, updated_at=excluded.updated_at`,
    ).run(config.project.id, config.project.name, workspace, configFile, config.project.defaultAgent, config.project.defaultPromptTemplate, now, now);
  }
  for (const [index, ticket] of legacyTickets.tickets.entries()) {
    const sessionId = ticket.chat?.threadId ?? null;
    if (sessionId) ticketsWithSessions += 1;
    if (!db || input.dryRun) continue;
    // Stable ids make re-imports idempotent: the legacy ticket id when
    // present, otherwise a deterministic hash of its content.
    const legacyId = ticket.id && /^[a-f0-9-]{36}$/.test(ticket.id) ? ticket.id : idFor(`legacy-ticket:${config.project.id}:${ticket.branch ?? ticket.title ?? index}`);
    db.prepare(
      `INSERT INTO tickets (id, project_id, title, description, status, scope, branch, additions, position, active_run_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    ).run(
      legacyId,
      config.project.id,
      ticket.title ?? 'Imported ticket',
      ticket.description ?? '',
      ['backlog', 'in_progress', 'done'].includes(ticket.status ?? '') ? ticket.status! : 'backlog',
      ticket.scope ?? 'both',
      ticket.branch ?? `codex/${slug(ticket.title ?? 'ticket')}`,
      index,
      ticket.createdAt ?? now,
      ticket.updatedAt ?? now,
    );
  }

  // ---- preview preferences ------------------------------------------------
  const legacyConfig = await readJson<{ paused?: string[]; removed?: string[]; profiles?: Record<string, string> }>('config.json', {});
  if (db && !input.dryRun) {
    // The primary workspace group is a fresh discovery (its key never appears
    // in legacy state), so pause it explicitly like every other preview.
    const primaryId = previewIdFor(config.project.id, '__primary__');
    db.prepare(
      `INSERT INTO previews (id, project_id, branch, is_primary, status, paused, created_at, updated_at, last_seen_at)
       VALUES (?, ?, '__primary__', 1, 'discovered', 1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET paused=1, updated_at=excluded.updated_at`,
    ).run(primaryId, config.project.id, now, now, now);
  }
  const legacyState = await readJson<{ ports?: Record<string, Record<string, number>>; previews?: Record<string, { name?: string; profile?: string }> }>('state.json', {});
  let previewPreferences = 0;
  if (db && !input.dryRun) {
    // Preview rows for every known legacy preview, including ones without
    // port assignments (paused/removed previews may never have started).
    const legacyIds = new Set([...Object.keys(legacyState.ports ?? {}), ...Object.keys(legacyState.previews ?? {})]);
    for (const legacyId of legacyIds) {
      const name = legacyState.previews?.[legacyId]?.name ?? legacyId;
      const previewId = previewIdFor(config.project.id, name);
      db.prepare(
        `INSERT INTO previews (id, project_id, branch, is_primary, status, created_at, updated_at, last_seen_at)
         VALUES (?, ?, ?, 0, 'discovered', ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      ).run(previewId, config.project.id, name, now, now, now);
      const ports = legacyState.ports?.[legacyId] ?? {};
      for (const [serviceId, port] of Object.entries(ports)) {
        db.prepare(
          `INSERT INTO port_allocations (project_id, preview_id, service_id, port) VALUES (?, ?, ?, ?)
           ON CONFLICT(project_id, preview_id, service_id) DO UPDATE SET port=excluded.port`,
        ).run(config.project.id, previewId, serviceId, port);
        previewPreferences += 1;
      }
      const environment = legacyConfig.profiles?.[legacyId] ?? legacyState.previews?.[legacyId]?.profile ?? null;
      const removed = (legacyConfig.removed ?? []).includes(legacyId);
      // Imported previews always arrive PAUSED: during a side-by-side
      // migration window the legacy manager may still be serving these
      // worktrees, and Gantry must not double-start services underneath it.
      // Resuming a preview in Gantry transfers its control explicitly.
      db.prepare('UPDATE previews SET environment=COALESCE(?, environment), paused=1, archived=?, updated_at=? WHERE id=?').run(environment, removed ? 1 : 0, now, previewId);
    }
  }

  // ---- stale processes ----------------------------------------------------
  const legacyProcessCount = countLegacyProcesses(legacyState);
  if (legacyProcessCount > 0) {
    attention.push(
      `${legacyProcessCount} legacy service PIDs were recorded. None were imported as running; Gantry verifies real process ownership (pgid + command claim) on startup and adopts only what it can prove is its own.`,
    );
  }
  const loginFile = path.join(stateDir, 'preview-login.json');
  if (await hasFile(loginFile)) {
    attention.push(
      'Optional auto-login: copy your private preview-login.json into the Gantry data directory (or leave it; the banner renders without it). Credentials are never read by the importer.',
    );
  }
  if (services.some((service) => service.banner?.autoLogin)) {
    attention.push('Frontend banner auto-login expects a project-provided module (frontend src/services/preview-login.ts default-exports an async login(credentials) function). Until it exists, the banner renders without signing in.');
  }

  return {
    workspace,
    configFile: wroteConfig ? configFile : input.dryRun ? configFile : null,
    dryRun: Boolean(input.dryRun),
    imported: {
      tickets: legacyTickets.tickets.length,
      ticketsWithSessions,
      previewPreferences,
      previewsImportedPaused: true,
      environments: environments.map((env) => env.id),
      repositories: repositories.map((repo) => repo.id),
      services: services.map((service) => service.id),
      promptTemplate: 'builtin:paper-setter-legacy',
    },
    attention,
    skipped,
    rollback:
      'The legacy manager was not modified. Gantry runs on its own port (default 4500) with its own data directory, so both can run side-by-side. To abandon the migration: delete the generated gantry.yaml and the Gantry data directory; legacy state, worktrees and profiles remain untouched.',
  };
}

interface LegacyTicket {
  id?: string;
  title?: string;
  description?: string;
  status?: string;
  scope?: string;
  branch?: string;
  createdAt?: string;
  updatedAt?: string;
  chat?: { threadId?: string | null; status?: string } | null;
}

async function hasFile(file: string): Promise<boolean> {
  try {
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}

function slug(title: string): string {
  return (
    String(title || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 54) || 'ticket'
  );
}

function countLegacyProcesses(state: { previews?: Record<string, { name?: string; profile?: string; services?: Record<string, { pid?: number }> }> }): number {
  let count = 0;
  for (const preview of Object.values(state.previews ?? {})) {
    for (const service of Object.values(preview.services ?? {})) {
      if (service.pid) count += 1;
    }
  }
  return count;
}

function structuredCloneSafe(config: ProjectConfig): ProjectConfig {
  return JSON.parse(JSON.stringify(config)) as ProjectConfig;
}

/** Stable, human-readable YAML emission (comments preserved by format, not content). */
function buildYaml(config: ProjectConfig): string {
  const plain = structuredCloneSafe(config);
  return `# Generated by \`gantry import-legacy\`. Secrets live in the referenced private env files,\n# never in this file. Edit freely; Gantry reloads it on every discovery pass.\n${stringifyYaml(plain)}`;
}
