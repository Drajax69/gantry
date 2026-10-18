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
  nodes: [
    { id: 'plan', label: 'Plan', kind: 'agent', instructions: 'Inspect the repository and plan the implementation.', dependsOn: [] },
    { id: 'implement', label: 'Implement', kind: 'agent', instructions: 'Implement the ticket following the plan.', dependsOn: ['plan'] },
    { id: 'test', label: 'Test', kind: 'agent', instructions: 'Run appropriate local validation and fix failures.', dependsOn: ['implement'] },
    {
      id: 'trace',
      label: 'Create Playwright trace',
      kind: 'agent',
      instructions: 'Verify the local preview and save private browser evidence.',
      dependsOn: ['test'],
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
