import { ticketWorkflow } from '../tickets/workflow.js';
import path from 'node:path';
import { interpolate, VarError, BUILTIN_TEMPLATES, type ProjectConfig, type PromptLayer } from '@gantry/shared';
import type { LoadedProject } from '../projects/registry.js';
import type { TicketRow } from '../tickets/store.js';

/**
 * Prompt rendering. Templates compose from named layers:
 *
 *   base (builtin or project template, following `extends` chains)
 *   -> repository instructions (discovered AGENTS.md/CLAUDE.md paths)
 *   -> agent-specific notes
 *   -> per-ticket additions
 *
 * Templates use the same `${var}` interpolation as the rest of Gantry, so
 * unknown or missing variables produce a helpful, consistent error before
 * anything is started.
 */

export interface PromptContext {
  ticket: TicketRow;
  project: LoadedProject;
  /** Absolute paths of instruction files that exist on disk right now. */
  instructionFiles: string[];
  /** Adapter-specific prompt additions (may be empty). */
  agentNotes: string;
  /** Extra text requested for this specific ticket. */
  ticketAdditions?: string | null;
  /** Local control-plane port for graph progress reporting. */
  workflowPort?: number;
  /** Automatic node execution receives conventions without instructions to drive the entire graph. */
  includeWorkflow?: boolean;
}

export function templateBody(config: ProjectConfig, templateId: string, seen = new Set<string>()): { body: string; label: string; chain: string[] } {
  if (seen.has(templateId)) throw new Error(`Prompt template chain contains a cycle at "${templateId}"`);
  seen.add(templateId);
  if (templateId === 'builtin:default') return { body: DEFAULT_TEMPLATE, label: 'Default', chain: ['builtin:default'] };
  if (templateId === 'builtin:paper-setter-legacy') return { body: PAPER_SETTER_LEGACY_TEMPLATE, label: 'Paper Setter legacy', chain: ['builtin:paper-setter-legacy'] };
  const template = config.promptTemplates.find((candidate) => candidate.id === templateId);
  if (!template) {
    throw new Error(
      `Unknown prompt template "${templateId}". Available: ${BUILTIN_TEMPLATES.join(', ')}${config.promptTemplates.length ? ', ' : ''}${config.promptTemplates.map((t) => t.id).join(', ')}`,
    );
  }
  const parent = template.extends ? templateBody(config, template.extends, seen) : null;
  return {
    body: parent ? `${parent.body}\n\n${template.body}` : template.body,
    label: template.label,
    chain: [...(parent?.chain ?? []), templateId],
  };
}

export function repositoryPath(project: LoadedProject, repositoryId: string): string {
  const repo = project.config.repositories.find((candidate) => candidate.id === repositoryId);
  return path.resolve(project.workspace, repo?.path ?? '.');
}

/** Build the variable context for a ticket. Throws VarError for missing env references. */
export function buildPromptVars(
  project: LoadedProject,
  ticket: TicketRow,
  context: { artifactDir: string; previewUrl: string | null; urls: Record<string, string>; paths: Record<string, string>; previewLoginEmail?: string | null },
): Record<string, string> {
  const config = project.config;
  const vars: Record<string, string> = {
    'ticket.title': ticket.title,
    'ticket.description': ticket.description || 'No additional notes were provided.',
    'ticket.notes': ticket.description || 'No additional notes were provided.',
    'ticket.scope': ticket.scope,
    'ticket.scopeDescription': config.scopes.find((scope) => scope.id === ticket.scope)?.description || ticket.scope,
    'ticket.branch': ticket.branch,
    branch: ticket.branch,
    workspace: project.workspace,
    artifactDir: context.artifactDir,
    previewUrl: context.previewUrl ?? '(preview not ready yet — it is prepared after the agent starts)',
    // The auto-login identity (read server-side from the private credentials
    // file). Templates that reference it fail fast when it is unconfigured.
    previewLoginEmail: context.previewLoginEmail?.trim() ?? '',
    'safety.testRecordPrefix': config.safety.testRecordPrefix,
    'safety.manualTestFile': config.safety.manualTestFile,
    'project.id': config.project.id,
    'project.name': config.project.name,
  };
  for (const repo of config.repositories) {
    vars[`repo.${repo.id}`] = repositoryPath(project, repo.id);
  }
  for (const [serviceId, url] of Object.entries(context.urls)) {
    vars[`url.${serviceId}`] = url;
  }
  for (const [serviceId, servicePath] of Object.entries(context.paths)) {
    vars[`path.${serviceId}`] = servicePath;
  }
  return vars;
}

export interface RenderedPrompt {
  prompt: string;
  layers: PromptLayer[];
  templateLabel: string;
}

export function renderPrompt(project: LoadedProject, ticket: TicketRow, vars: Record<string, string>, context: PromptContext): RenderedPrompt {
  const template = templateBody(project.config, project.config.project.defaultPromptTemplate);
  if (template.body.includes('${previewLoginEmail}') && !vars['previewLoginEmail']) {
    throw new Error(
      'This prompt template requires the preview auto-login identity. Add a private preview-login.json containing {"email": "...", "password": "..."} to the Gantry data directory, or pick a template that does not reference ${previewLoginEmail}.',
    );
  }
  const layers: PromptLayer[] = [];
  const sections: string[] = [interpolate(template.body, vars)];
  layers.push({ kind: 'base' });

  if (context.instructionFiles.length) {
    layers.push({ kind: 'repo-instructions', files: context.instructionFiles });
    sections.push(`Repository and workspace instructions (read these before coding):\n${context.instructionFiles.map((file) => `- ${file}`).join('\n')}`);
  }
  if (context.agentNotes.trim()) {
    layers.push({ kind: 'agent-notes', agentId: ticket.project_id });
    sections.push(context.agentNotes.trim());
  }
  layers.push({ kind: 'ticket' });
  if (context.ticketAdditions?.trim()) {
    layers.push({ kind: 'ticket-additions' });
    sections.push(`Additional notes for this ticket:\n${context.ticketAdditions.trim()}`);
  }
  const workflow = ticketWorkflow(ticket);
  if (workflow && context.includeWorkflow !== false) {
    sections.push(`Ticket workflow (this ticket's independent graph):\n${workflow.graph.nodes.map(node =>
      `- ${node.id}: ${node.label} [${node.kind}; ${workflow.states[node.id]?.state ?? 'pending'}], after: ${node.dependsOn.join(', ') || 'start'}\n  ${node.instructions}`
    ).join('\n')}\nFollow dependency order. Independent ready agent steps may be delegated in parallel; wait for all dependencies before a join. Human steps require a user response before completion. Report progress using the local Gantry CLI: gantry workflow ${ticket.id} <step-id> <running|waiting|done|failed> --port ${context.workflowPort ?? 4500} --message "details". If the CLI is not installed, GET http://127.0.0.1:${context.workflowPort ?? 4500}/api/tickets/${ticket.id}/workflow, then POST JSON to http://127.0.0.1:${context.workflowPort ?? 4500}/api/tickets/${ticket.id}/workflow-progress with revision (from the GET), nodeId, state, and message. On HTTP 409, reload the current revision and retry. Use waiting with a clear question when blocked on the user. Never mark work complete until verified. If reporting is unavailable, tell the user rather than claiming the graph was updated.`);
  }
  return { prompt: sections.join('\n\n'), layers, templateLabel: template.label };
}

/** Static validation of a template against a project's variable surface. */
export function validateTemplate(config: ProjectConfig, templateId: string): string[] {
  try {
    const { body } = templateBody(config, templateId);
    interpolate(body, dryRunVars(config));
    return [];
  } catch (error) {
    return [error instanceof VarError ? error.message : (error as Error).message];
  }
}

function dryRunVars(config: ProjectConfig): Record<string, string> {
  const vars: Record<string, string> = {
    'ticket.title': 'Example ticket',
    'ticket.description': 'Example description',
    'ticket.notes': 'Example description',
    'ticket.scope': config.scopes[0]?.id ?? 'both',
    'ticket.scopeDescription': config.scopes[0]?.description ?? 'all areas',
    'ticket.branch': `${config.project.branchPrefix}/example`,
    branch: `${config.project.branchPrefix}/example`,
    workspace: '/workspace',
    artifactDir: '/artifacts',
    previewUrl: 'http://127.0.0.1:5200',
    previewLoginEmail: 'login@example.invalid',
    'safety.testRecordPrefix': config.safety.testRecordPrefix,
    'safety.manualTestFile': config.safety.manualTestFile,
    'project.id': config.project.id,
    'project.name': config.project.name,
  };
  for (const repo of config.repositories) vars[`repo.${repo.id}`] = `/workspace/${repo.path}`;
  for (const service of config.services) {
    vars[`url.${service.id}`] = service.openUrl ?? 'http://127.0.0.1:5200';
    vars[`path.${service.id}`] = '/workspace';
  }
  return vars;
}

const DEFAULT_TEMPLATE = `Implement the following ticket in the worktrees prepared for it.

Ticket: \${ticket.title}

\${ticket.description}

Scope: \${ticket.scopeDescription}.
Branch: \${ticket.branch}
Local preview: \${previewUrl}
Private evidence directory (local only, never commit or upload): \${artifactDir}

Follow the workspace and repository instruction files and the established architecture. Preserve unrelated work. Run the appropriate local validation and do not run live end-to-end suites, migrations, seeds, deploys, or production mutations.

Commit and push each repository you change. Create a pull request for each changed repository, but do not merge it. The local preview manager will discover these worktrees automatically.

Browser verification required before opening pull requests:
1. After the final code changes, run a focused browser test of the ticket's primary user journey against the local preview URL above. Do not run any live or staging suite, create remote fixtures, seed data, or target a deployed URL.
2. You may create new, isolated records needed by the test only when every created item's visible name starts with \${safety.testRecordPrefix} followed by a ticket-specific label. Record every created item in your summary. Do not edit, delete, archive, publish, submit, bulk-change, or otherwise mutate any pre-existing record.
3. If meaningful verification requires deletion, destructive changes, mass changes, irreversible actions, or mutation of an existing record, do not perform that part. Save \${artifactDir}/\${safety.manualTestFile} with the exact untested steps, why automation stopped, the risk, and what should be verified manually. Mention this prominently in your final response and PR description, and do not claim full coverage. Continue with any remaining safe automated checks.
4. Record the final safe passing run with tracing, screenshots, and video where the test tooling supports them. Save the final evidence exactly as \${artifactDir}/trace.zip, \${artifactDir}/video.webm, \${artifactDir}/final.png, and \${artifactDir}/summary.md. The summary must state the tested journey, assertions, command, result, created records, and any manual-testing boundary.
5. If the browser test fails because of the implementation, inspect the evidence, fix the issue, and rerun the same journey until the final safe run passes. Do not weaken meaningful assertions merely to make it pass.
6. Keep the evidence private and local: never commit it or upload it to a pull request. Report the local evidence paths and the exact test result in your final response and PR description.`;

/**
 * Paper Setter legacy preset: a variable-generalized port of the CURRENT
 * ticketPrompt implementation (including the auto-login identity contract
 * and the human-watchable evidence pass), with absolute paths replaced by
 * variables. Behavior is preserved exactly.
 */
const PAPER_SETTER_LEGACY_TEMPLATE = `Implement this Paper Setter ticket in the existing \${ticket.branch} worktrees.

Ticket: \${ticket.title}

\${ticket.description}

Scope: \${ticket.scopeDescription}.
Paper Setter Codex project: \${workspace}
Frontend worktree: \${repo.frontend}
Backend worktree: \${repo.backend}
Local preview: \${previewUrl}
E2E harness: \${repo.e2e}
Private E2E evidence directory: \${artifactDir}

Follow the workspace and repository AGENTS.md files and the established architecture. Make product changes only in the listed ticket worktrees, not the primary repository checkouts under the Paper Setter project root. Preserve unrelated work. Run the appropriate local validation and do not run live E2E, migrations, seeds, deploys, or production mutations except for the narrowly permitted additive \${safety.testRecordPrefix} records below. Commit and push each repository you change. Create a GitHub pull request for each changed repository, but do not merge it. The local preview manager will discover these worktrees automatically.

Browser verification required before opening pull requests:
1. Every Playwright browser run for this ticket, including retries and the final recorded run, must use the preview manager's auto-login identity \${previewLoginEmail}. With tracing disabled, navigate to the local preview and wait for [data-preview-auth-status][data-state="ready"], then assert that its visible text contains \${previewLoginEmail} before performing ticket actions. Enable tracing only after this private login bootstrap has completed, and repeat the identity assertion as the first traced check. Do not reload the page after tracing begins. Do not type credentials, read or copy private credential files, use mocked authentication, fake users, alternate accounts, or storage state from another identity. Do not intercept or block authentication endpoints. Supplemental non-browser tests may still use mocks. If this exact identity cannot be established, stop browser verification, write \${artifactDir}/\${safety.manualTestFile} describing the authentication failure, and do not claim a passing E2E result.
2. After the final code changes, run a focused Playwright test of the ticket's primary user journey against the local preview URL above, driving the system through the browser. Use the existing E2E harness for Playwright tooling and established helpers only when they preserve the required real auto-login identity. Do not run any live or staging suite, create remote fixtures, seed data, or target a deployed URL.
3. The preview uses shared data. You may create new, isolated records needed by the test (for example a question, exam, tag, folder, or similar item) only when every created item's visible name starts with \${safety.testRecordPrefix} followed by a ticket-specific label or timestamp. Record every created item in the summary. Do not edit, delete, archive, publish, submit, send, bulk-change, or otherwise mutate any pre-existing record. Do not clean up \${safety.testRecordPrefix} records when cleanup itself would delete or destructively mutate data.
4. If meaningful verification requires deletion, destructive changes, mass changes, irreversible actions, or mutation of an existing record, do not perform that part. Save \${artifactDir}/\${safety.manualTestFile} with the exact untested steps, why automation stopped, the risk, and what the user should verify manually. Mention this prominently in your final response and PR description, and do not claim full E2E coverage. Continue with any remaining safe automated checks.
5. After the journey passes at normal speed, rerun that same safe journey once as a human-watchable evidence pass with Playwright tracing, screenshots, and video enabled. Use Playwright slowMo: 400 for the recorded browser. Add an approximately 1000 ms visible hold after each meaningful navigation, opened modal, submitted form, and displayed result, plus a 2500 ms hold on the final verified state before the final screenshot. Keep assertions and readiness waits event-driven; these review holds are in addition to them. Do not speed up or time-compress the saved video. Save the final evidence exactly as \${artifactDir}/trace.zip, \${artifactDir}/video.webm, \${artifactDir}/final.png, and \${artifactDir}/summary.md. The summary must state the authenticated identity, tested journey, assertions, command, result, slowMo and review-hold settings, created \${safety.testRecordPrefix} records, and any manual-testing boundary.
6. If the browser test fails because of the implementation, inspect the evidence, fix the issue, and rerun the same journey. Continue until the final safe run passes. Do not weaken meaningful assertions merely to make it pass.
7. Keep the evidence private and local: never commit it or upload it to a pull request. In your final response and PR description, report the local evidence paths and the exact Playwright result.

General coding guidelines:
1. Follow the repository's established languages, file types, and module conventions. Do not introduce .cjs or .mjs files unless the repository already uses them or they are temporary scripts.
2. Remove temporary, debugging, and one-off files before opening a pull request. Keep migration files and other durable artifacts when they are required by the ticket.
3. Inspect similar existing features and follow their conventions before implementing the change.
4. Minimize Firebase reads. If a proposed data model stores every new item as a separate document, stop and alert the user before proceeding.
5. Do not add caching or transactions unless the user explicitly asks for them or they are required for correctness. If you believe either is required, explain why and confirm with the user before implementing it.`;
