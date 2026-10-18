import { z } from 'zod';

export const workflowSchema = z
  .object({
    nodes: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
          label: z.string().trim().min(1).max(100),
          instructions: z.string().max(10000).default(''),
          kind: z.enum(['agent', 'human']).default('agent'),
          dependsOn: z.array(z.string()).max(50).default([]),
        }),
      )
      .min(1)
      .max(50),
  })
  .superRefine(({ nodes }, ctx) => {
    const ids = new Set(nodes.map((n) => n.id));
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (ids.size !== nodes.length) fail('Each step needs a unique ID.');
    for (const node of nodes) {
      if (new Set(node.dependsOn).size !== node.dependsOn.length) fail(`Duplicate dependencies for ${node.label}.`);
      if (node.dependsOn.some((id) => !ids.has(id) || id === node.id)) fail(`Invalid dependency for ${node.label}.`);
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
