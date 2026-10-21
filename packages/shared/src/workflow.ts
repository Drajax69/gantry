import { z } from 'zod';

export const workflowSchema = z
  .object({
    autoStart: z.boolean().optional(),
    entryNodeId: z.string().optional(),
    edges: z
      .array(z.object({ id: z.string().regex(/^[a-z][a-z0-9-]{0,100}$/), source: z.string(), target: z.string(), label: z.string().trim().min(1).max(2000) }))
      .max(250)
      .optional(),
    nodes: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
          label: z.string().trim().min(1).max(100),
          position: z.object({ x: z.number().finite().min(0).max(10000), y: z.number().finite().min(0).max(10000) }).optional(),
          instructions: z.string().max(10000).default(''),
          kind: z.enum(['agent', 'human']).default('agent'),
          providerId: z.string().max(100).optional(),
          model: z.string().max(200).optional(),
          reasoningEffort: z.enum(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']).optional(),
          retryTarget: z.string().optional(),
          maxAttempts: z.number().int().min(1).max(10).optional(),
          workspaceExclusive: z.boolean().optional(),
          freshSession: z.boolean().optional(),
          dependsOn: z.array(z.string()).max(50).default([]),
        }),
      )
      .max(50),
  })
  .superRefine(({ nodes, edges, entryNodeId, autoStart }, ctx) => {
    const ids = new Set(nodes.map((n) => n.id));
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (ids.size !== nodes.length) fail('Each step needs a unique ID.');
    if (edges !== undefined) {
      if (nodes.length === 0) {
        if (edges.length || entryNodeId || autoStart) fail('An empty board cannot run. Add a start node first.');
        return;
      }
      if (!entryNodeId || !ids.has(entryNodeId)) fail('Choose a start node.');
      if (new Set(edges.map((e) => e.id)).size !== edges.length) fail('Each connection needs a unique ID.');
      for (const edge of edges)
        if (!ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target) fail('Connections must link two different nodes.');
      if (autoStart) {
        const reached = new Set([entryNodeId]);
        for (let i = 0; i < nodes.length; i++) for (const edge of edges) if (reached.has(edge.source)) reached.add(edge.target);
        if (nodes.some((n) => !reached.has(n.id))) fail('Connect every node to the start before enabling automatic runs.');
      }
      return; // Directed routes may loop. The executor bounds repeated visits.
    }
    if (!nodes.length) fail('Add at least one step.');
    for (const node of nodes) {
      if (node.retryTarget && (!ids.has(node.retryTarget) || node.retryTarget === node.id)) fail(`Invalid retry target for ${node.label}.`);
      if (new Set(node.dependsOn).size !== node.dependsOn.length) fail(`Duplicate dependencies for ${node.label}.`);
      if (node.dependsOn.some((id) => !ids.has(id) || id === node.id)) fail(`Invalid dependency for ${node.label}.`);
    }
    for (const node of nodes)
      if (node.retryTarget) {
        const ancestors = new Set<string>();
        const collect = (id: string) => {
          if (ancestors.has(id)) return;
          ancestors.add(id);
          for (const parent of nodes.find((n) => n.id === id)?.dependsOn ?? []) collect(parent);
        };
        for (const id of node.dependsOn) collect(id);
        if (!ancestors.has(node.retryTarget)) fail(`Retry target for ${node.label} must be an earlier dependency.`);
      }
    const visited = new Set<string>();
    const active = new Set<string>();
    const visit = (id: string): boolean => {
      if (active.has(id)) return false;
      if (visited.has(id)) return true;
      active.add(id);
      for (const parent of nodes.find((n) => n.id === id)?.dependsOn ?? []) if (!visit(parent)) return false;
      active.delete(id);
      visited.add(id);
      return true;
    };
    if (nodes.some((n) => !visit(n.id))) fail('Dependencies must not form a cycle.');
  });
export type Workflow = z.infer<typeof workflowSchema>;
export type StepState = 'pending' | 'running' | 'waiting' | 'done' | 'failed';
export interface WorkflowRun {
  graph: Workflow;
  revision: number;
  states: Record<string, { state: StepState; message: string }>;
}
export const DEFAULT_WORKFLOW: Workflow = {
  autoStart: true,
  entryNodeId: 'plan',
  edges: [
    { id: 'plan-implement', source: 'plan', target: 'implement', label: 'The implementation plan is complete and no consequential question is unresolved.' },
    { id: 'implement-review', source: 'implement', target: 'review', label: 'Implementation and relevant local validation are complete.' },
    { id: 'review-implement', source: 'review', target: 'implement', label: 'Review found actionable issues and requested changes. Implement the corrections, then review again.' },
    { id: 'review-create-pr', source: 'review', target: 'create-pr', label: 'Review passed with no unresolved actionable findings and the relevant validation passed.' },
  ],
  nodes: [
    {
      id: 'plan', label: 'Plan', kind: 'agent', position: { x: 80, y: 160 }, dependsOn: [],
      instructions: `Read the ticket, workspace and repository instructions, and Git status in each relevant checkout. Trace the existing behaviour and affected callers before proposing changes.
Create a concise, actionable plan: intended user-visible outcome, acceptance criteria, files and repositories involved, implementation steps, and the smallest meaningful validation. Follow the existing architecture and package manager. Identify material edge cases and compatibility concerns.
Make routine decisions yourself. Ask only when an unresolved choice materially affects scope or correctness; otherwise hand off a concrete plan with outcome done. If blocked on a decision, use outcome waiting and state the exact question.
This stage is planning only: do not edit product code, commit, push, or open a PR.`,
    },
    {
      id: 'implement', label: 'Implement', kind: 'agent', position: { x: 400, y: 160 }, dependsOn: ['plan'], maxAttempts: 3,
      instructions: `Implement the plan in the prepared ticket worktrees. Read the prior handovers and repository instructions, inspect Git status, and preserve unrelated work. If this is a return from Review, address every actionable finding first.
Follow surrounding patterns and keep the change focused. Update affected callers, types, documentation, and contracts together. Add or update meaningful tests for changed behaviour. Run the relevant local checks; for user-facing changes, exercise the affected journey against a local preview when available. Do not require browser tests for changes without a browser surface.
Fix failures introduced by the change. Report exact commands, results, and any unavailable validation honestly. Hand off a summary of changes, acceptance criteria covered, and remaining limitations. Use outcome waiting if a required dependency or decision blocks completion.
Do not push or open a PR; publishing belongs to Create PR. Do not merge or deploy.`,
    },
    {
      id: 'review', label: 'Review', kind: 'agent', position: { x: 720, y: 160 }, dependsOn: ['implement'], freshSession: true,
      instructions: `Independently review the implementation against the ticket, plan, and repository instructions. Inspect the full ticket diff, including uncommitted and newly added files, and enough surrounding code to verify affected callers and contracts. Do not rely only on the implementer's summary.
Prioritize correctness, regressions, missing requirements, access control, data integrity, and failure handling. Verify suspected issues in the actual code and run focused local checks when useful. Keep validation proportional to the change; distinguish confirmed defects from speculation or style preferences.
If actionable issues remain, return outcome changes_requested with file locations, triggering scenarios, impact, and concrete corrections for Implement. Do not fix the implementation in this stage.
Otherwise return outcome done, explicitly state there are no actionable findings, and summarize validation and its limits. If required verification cannot be completed, return waiting rather than approving without evidence. Do not commit, push, create a PR, merge, or deploy.`,
    },
    {
      id: 'create-pr',
      label: 'Create PR',
      kind: 'agent',
      position: { x: 1040, y: 160 },
      dependsOn: ['review'],
      instructions: `Publish the reviewed work. Confirm the latest review passed, relevant checks passed, and no actionable findings remain. Inspect Git status and the full diff in every changed repository. Stage only the ticket's intended changes; exclude secrets, private environment files, logs, and generated evidence.
Commit with a concise message matching repository conventions. Push the ticket branch without force-pushing. Use the repository's actual remote and base branch. Create a GitHub pull request for each changed repository, or update the existing PR for that branch rather than duplicating it.
Give each PR a clear title and a concise description of the outcome, key changes, exact validation results, and any limitations. Link related PRs when the ticket spans repositories. Report every PR URL in the structured pullRequests handover.
If authentication, permissions, missing validation, or unresolved findings block publication, return waiting with the concrete next step. Never claim a PR exists without confirming it. Do not merge or deploy.`,
    },
  ],
};
export function newWorkflow(graph: Workflow = DEFAULT_WORKFLOW): WorkflowRun {
  const copy = workflowSchema.parse(graph);
  return { graph: copy, revision: 0, states: Object.fromEntries(copy.nodes.map((n) => [n.id, { state: 'pending' as const, message: '' }])) };
}
export function readySteps(run: WorkflowRun) {
  return run.graph.nodes.filter((n) => run.states[n.id]?.state === 'pending' && n.dependsOn.every((id) => run.states[id]?.state === 'done'));
}
export function workflowSummary(run: WorkflowRun) {
  const active = run.graph.nodes.filter((n) => ['running', 'waiting', 'failed'].includes(run.states[n.id]?.state ?? ''));
  const waiting = active.some((n) => run.states[n.id]?.state === 'waiting') || readySteps(run).some((n) => n.kind === 'human');
  const current = waiting
    ? run.graph.nodes.filter((n) => run.states[n.id]?.state === 'waiting' || (n.kind === 'human' && readySteps(run).some((r) => r.id === n.id)))
    : active.length
      ? active
      : readySteps(run);
  return { waiting, current: current.map((n) => n.label), complete: run.graph.nodes.every((n) => run.states[n.id]?.state === 'done') };
}

/** Portable graph files contain configuration only, never ticket execution state. */
const workflowFileSchema = z.object({
  format: z.literal('gantry-workspace-graph'),
  version: z.literal(1),
  graph: workflowSchema,
});

export function exportWorkflow(graph: Workflow): string {
  const file = workflowFileSchema.parse({
    format: 'gantry-workspace-graph',
    version: 1,
    graph,
  });

  return JSON.stringify(file, null, 2) + '\n';
}

export function importWorkflow(text: string): Workflow {
  const file = workflowFileSchema.parse(JSON.parse(text));

  return { ...file.graph, autoStart: false };
}
