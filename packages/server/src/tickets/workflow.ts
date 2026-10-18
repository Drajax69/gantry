import { newWorkflow, workflowSchema, type WorkflowRun, type StepState } from '@gantry/shared';
import { z } from 'zod';
import type { Database } from '../db/db.js';
import type { TicketRow } from './store.js';

export function ticketWorkflow(ticket: Pick<TicketRow, 'workflow_json'>): WorkflowRun | null {
  return ticket.workflow_json ? (JSON.parse(ticket.workflow_json) as WorkflowRun) : null;
}
const progressSchema = z.object({
  nodeId: z.string(),
  state: z.enum(['running', 'waiting', 'done', 'failed']),
  message: z.string().trim().max(2000).default(''),
});
export function changeStep(run: WorkflowRun, input: unknown): WorkflowRun {
  const { nodeId, state, message } = progressSchema.parse(input);
  const node = run.graph.nodes.find((n) => n.id === nodeId);
  if (!node) throw new Error('Unknown graph step.');
  if (!node.dependsOn.every((id) => run.states[id]?.state === 'done')) throw new Error('Complete this step’s dependencies first.');
  const previous = run.states[nodeId]!.state;
  if (previous === state && run.states[nodeId]!.message === message) return run;
  if (previous === 'done') throw new Error('Completed steps cannot be restarted.');
  if (state === 'waiting' && !message) throw new Error('Describe what you need from the user.');
  if (node.kind === 'human' && state === 'running') throw new Error('Human steps wait for a user response.');
  return { ...run, revision: run.revision + 1, states: { ...run.states, [nodeId]: { state: state as StepState, message } } };
}
export function replaceGraph(run: WorkflowRun | null, graph: unknown): WorkflowRun {
  const next = newWorkflow(workflowSchema.parse(graph));
  // Preserve progress and protect the meaning of steps already underway.
  for (const node of run?.graph.nodes ?? []) {
    if (run!.states[node.id]?.state === 'pending') continue;
    const replacement = next.graph.nodes.find((n) => n.id === node.id);
    if (JSON.stringify(replacement) !== JSON.stringify(node)) throw new Error('Only steps that have not started can be edited or removed.');
    next.states[node.id] = { ...run!.states[node.id]! };
  }
  next.revision = (run?.revision ?? -1) + 1;
  return next;
}
export function saveTicketWorkflow(db: Database, ticket: TicketRow, run: WorkflowRun) {
  const result = db
    .prepare('UPDATE tickets SET workflow_json=?, updated_at=? WHERE id=? AND workflow_json IS ?')
    .run(JSON.stringify(run), new Date().toISOString(), ticket.id, ticket.workflow_json ?? null);
  if (!Number(result.changes)) throw Object.assign(new Error('Graph changed. Reload and try again.'), { statusCode: 409 });
  return run;
}
