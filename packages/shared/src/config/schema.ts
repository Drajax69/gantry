import { z } from 'zod';

/**
 * Project configuration schema (`gantry.yaml` at a workspace root).
 *
 * Design rules:
 * - Secrets never live in this file. Environments *reference* private env
 *   files by path; the referenced files are read server-side only.
 * - Commands may be strings (run through a shell, shown before first use) or
 *   argv arrays (no shell), and support `${var}` placeholders.
 * - Everything is overridable per platform via `platform.<os>` blocks.
 */

export const API_VERSION = 'gantry.dev/v1';

/**
 * A command is authored as a shell string or an argv array; the parsed form
 * `{ kind, value }` is also accepted so normalized config round-trips.
 */
export const commandSchema = z
  .union([z.string().min(1), z.array(z.string().min(1)), z.object({ kind: z.enum(['shell', 'argv']), value: z.union([z.string().min(1), z.array(z.string().min(1))]) })])
  .transform((value) => {
    if (typeof value === 'string') return { kind: 'shell' as const, value };
    if (Array.isArray(value)) return { kind: 'argv' as const, value };
    return Array.isArray(value.value) ? { kind: 'argv' as const, value: value.value } : { kind: 'shell' as const, value: value.value };
  });
export type CommandSpec = z.infer<typeof commandSchema>;

const platformCommandOverrides = z.object({
  /** Start this service only in checkouts containing this relative file. */
  whenFile: z.string().min(1).refine(value => !value.startsWith('/') && !value.split(/[\\/]/).includes('..'), 'Use a relative path inside the checkout').optional(),
  install: commandSchema.optional(),
  start: commandSchema.optional(),
});

/** Per-OS command overrides: `platform: { win32: { start: ... } }`. */
export const platformOverridesSchema = z.object({
  darwin: platformCommandOverrides.optional(),
  win32: platformCommandOverrides.optional(),
  linux: platformCommandOverrides.optional(),
});
export type PlatformOverrides = z.infer<typeof platformOverridesSchema>;

/** URL that may reference `${port}`; validated with a sample substitution. */
const templatedUrl = z
  .string()
  .min(1)
  .refine(
    (value) => {
      try {
        new URL(value.replaceAll('${port}', '5212'));
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Must be an http(s) URL; it may reference ${port}' },
  );

export const repositorySchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, 'Repository id must be lowercase kebab-case'),
  /** Path relative to the workspace root, or absolute inside the workspace. */
  path: z.string().min(1),
  remote: z.string().min(1).default('origin'),
  defaultBranch: z.string().min(1).default('main'),
  /** Create ticket worktrees for this repository. Tooling repos set false. */
  worktree: z.boolean().default(true),
  /** Project fails to load if a required repository is missing on disk. */
  required: z.boolean().default(true),
  /** `product` repositories join branch previews; `tooling` ones are only mounted into tickets. */
  role: z.enum(['product', 'tooling']).default('product'),
  /** Where to look for repo instructions, relative to the repository. */
  instructions: z.array(z.string()).default(['AGENTS.md', 'CLAUDE.md']),
});
export type RepositoryConfig = z.infer<typeof repositorySchema>;

export const serviceSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, 'Service id must be lowercase kebab-case'),
  repository: z.string().min(1),
  /** `command` runs `start` verbatim. `vite`/`node`/`python` use Gantry's managed runners (banner, initServer, flask). */
  runtime: z.enum(['command', 'vite', 'node', 'python']).default('command'),
  /** Start this service only in checkouts containing this relative file. */
  whenFile: z.string().min(1).refine(value => !value.startsWith('/') && !value.split(/[\\/]/).includes('..'), 'Use a relative path inside the checkout').optional(),
  install: commandSchema.optional(),
  /** Required for runtime: command; managed runtimes (vite/node/python) start themselves. */
  start: commandSchema.optional(),
  healthUrl: templatedUrl.optional(),
  openUrl: templatedUrl.optional(),
  /** Fixed port, or leave unset to allocate from the project range. */
  port: z.number().int().min(1).max(65535).optional(),
  /** Services that must become ready before this one starts. */
  dependsOn: z.array(z.string()).default([]),
  /** Extra environment for this service. Values may reference ${port}, ${env:NAME}, etc. */
  env: z.record(z.string()).default({}),
  /** Env files loaded in order, later files win. Paths are relative to the repository checkout. */
  envFiles: z.array(z.string()).default([]),
  /** Working directory relative to the repository checkout. */
  workDir: z.string().default('.'),
  hooks: z
    .object({
      preStart: z.array(commandSchema).default([]),
      postStart: z.array(commandSchema).default([]),
    })
    .default({ preStart: [], postStart: [] }),
  platform: platformOverridesSchema.default({}),
  /** Managed vite runner: inject the local-preview banner and optional auto-login. */
  banner: z
    .object({
      enabled: z.boolean().default(true),
      autoLogin: z.boolean().default(false),
    })
    .optional(),
  /** runtime=node: module to import (must export initServer). runtime=python: entry script. */
  entry: z.string().optional(),
});
export type ServiceConfig = z.infer<typeof serviceSchema>;

export const environmentSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, 'Environment id must be lowercase kebab-case'),
  label: z.string().min(1),
  default: z.boolean().default(false),
  /** Per-service private env files. Paths are workspace-relative. Never commit these targets. */
  envFiles: z.record(z.string().min(1)).default({}),
  /** Non-secret values applied to every service. */
  env: z.record(z.string()).default({}),
  /** Keys that must be present after env files load; missing keys fail validation before a switch. */
  requireKeys: z.record(z.array(z.string())).default({}),
});
export type EnvironmentConfig = z.infer<typeof environmentSchema>;

export const ticketScopeSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, 'Scope id must be lowercase kebab-case'),
  label: z.string().min(1),
  /** Human-readable description rendered into prompts. */
  description: z.string().default(''),
});
export type TicketScope = z.infer<typeof ticketScopeSchema>;

export const defaultTicketScopes: z.infer<typeof ticketScopeSchema>[] = [
  { id: 'both', label: 'Frontend + backend', description: 'frontend and backend' },
  { id: 'frontend', label: 'Frontend', description: 'frontend' },
  { id: 'backend', label: 'Backend', description: 'backend' },
  { id: 'operations', label: 'Operations', description: 'operations and infrastructure' },
  { id: 'data', label: 'Data', description: 'data migrations and configuration' },
  { id: 'testing', label: 'Testing', description: 'testing and quality assurance' },
];

export const promptTemplateSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, 'Template id must be lowercase kebab-case'),
  label: z.string().min(1),
  body: z.string().min(1),
  /** Rendered before the body; a preset id (builtin:default, builtin:paper-setter-legacy) or template id. */
  extends: z.string().optional(),
});
export type PromptTemplateConfig = z.infer<typeof promptTemplateSchema>;

export const agentConfigSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, 'Agent id must be lowercase kebab-case'),
  /** Executable override; defaults to the adapter's discovery order. */
  binary: z.string().optional(),
  /** Extra adapter-specific arguments. */
  args: z.record(z.string()).default({}),
});
export type AgentConfig = z.infer<typeof agentConfigSchema>;

export const projectSchema = z.object({
  apiVersion: z.literal(API_VERSION, {
    errorMap: () => ({ message: `apiVersion must be "${API_VERSION}"` }),
  }),
  project: z.object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/, 'Project id must be lowercase kebab-case'),
    name: z.string().min(1).max(80),
    defaultAgent: z.string().min(1).default('codex'),
    defaultPromptTemplate: z.string().min(1).default('builtin:default'),
    /** Branch prefix for ticket branches: `${branchPrefix}/slug`. */
    branchPrefix: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/).default('ticket'),
    /** Where ticket worktrees are created, relative to the workspace. */
    worktreeRoot: z.string().default('.worktrees'),
    /** First port tried when allocating preview ports. */
    portBase: z.number().int().min(1024).max(65000).default(5200),
    portRange: z.number().int().min(16).default(1000),
    /** Instruction files discovered at workspace level (in addition to per-repo). */
    workspaceInstructions: z.array(z.string()).default(['AGENTS.md', 'CLAUDE.md']),
  }),
  repositories: z.array(repositorySchema).min(1, 'Declare at least one repository'),
  services: z.array(serviceSchema).default([]),
  environments: z.array(environmentSchema).default([]),
  promptTemplates: z.array(promptTemplateSchema).default([]),
  /** Ticket scopes offered in the UI and rendered into prompts. */
  scopes: z.array(ticketScopeSchema).default(defaultTicketScopes),
  agents: z.array(agentConfigSchema).default([]),
  safety: z
    .object({
      testRecordPrefix: z.string().default('TEST_'),
      manualTestFile: z.string().default('manual-test-needed.md'),
      /** Rendered into prompts as the project's validation/safety policy. */
      policy: z.string().optional(),
    })
    .default({ testRecordPrefix: 'TEST_', manualTestFile: 'manual-test-needed.md' }),
});
export type ProjectConfig = z.infer<typeof projectSchema>;

/** User-facing validation that collects all problems instead of failing fast. */
export function parseProjectConfig(raw: unknown): { ok: true; config: ProjectConfig } | { ok: false; errors: string[] } {
  const result = projectSchema.safeParse(raw);
  if (result.success) return { ok: true, config: result.data };
  const errors = result.error.issues.map((issue) => {
    const where = issue.path.length ? issue.path.map(String).join('.') : '(root)';
    return `${where}: ${issue.message}`;
  });
  return { ok: false, errors };
}

/** Service ids referenced by repositories must exist, and dependencies must be acyclic. */
export function validateConfigReferences(config: ProjectConfig): string[] {
  const errors: string[] = [];
  const repoIds = new Set(config.repositories.map((repo) => repo.id));
  const serviceIds = new Set(config.services.map((service) => service.id));
  for (const service of config.services) {
    if (!repoIds.has(service.repository)) {
      errors.push(`services.${service.id}.repository: unknown repository "${service.repository}"`);
    }
    if (service.runtime === 'command' && !service.start) {
      errors.push(`services.${service.id}.start: required when runtime is "command"`);
    }
    for (const dep of service.dependsOn) {
      if (!serviceIds.has(dep)) {
        errors.push(`services.${service.id}.dependsOn: unknown service "${dep}"`);
      }
    }
  }
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (id: string, stack: string[]): void => {
    const marker = state.get(id);
    if (marker === 'done') return;
    if (marker === 'visiting') {
      errors.push(`services: dependency cycle: ${[...stack, id].join(' -> ')}`);
      return;
    }
    state.set(id, 'visiting');
    for (const dep of config.services.find((service) => service.id === id)?.dependsOn ?? []) {
      if (serviceIds.has(dep)) visit(dep, [...stack, id]);
    }
    state.set(id, 'done');
  };
  for (const id of serviceIds) visit(id, []);
  const envIds = new Set(config.environments.map((env) => env.id));
  for (const service of config.services) {
    if (service.banner?.autoLogin && config.environments.length === 0) {
      errors.push(`services.${service.id}.banner.autoLogin requires at least one environment`);
    }
  }
  for (const env of config.environments) {
    for (const serviceId of Object.keys(env.envFiles)) {
      if (!serviceIds.has(serviceId)) {
        errors.push(`environments.${env.id}.envFiles: unknown service "${serviceId}"`);
      }
    }
  }
  void envIds;
  return errors;
}
