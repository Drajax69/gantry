import type { Workflow } from '../../../../packages/shared/src/workflow';

export type Outcome = 'done' | 'changes_requested' | 'waiting' | 'failed';
export interface Attempt {
  id: string;
  nodeId: string;
  startedAt: number;
  endedAt?: number;
  state: 'running' | Outcome | 'interrupted';
  summary: string;
  output: string;
  sessionId?: string;
  providerId: string;
  providerKind: 'codex' | 'claude' | 'openai';
  model: string;
  commits: Record<string, string>;
}
export interface Execution {
  ticketId: string;
  projectId: string;
  graph: Workflow;
  state: 'running' | 'paused' | 'waiting' | 'complete';
  message: string;
  steps: Record<string, 'pending' | 'running' | 'done' | 'waiting' | 'failed'>;
  attempts: Attempt[];
  defaultProviderId: string;
  updatedAt: number;
  replies?: { nodeId: string; message: string; at: number }[];
}
export function nextNode(run: Execution) {
  return run.graph.nodes.find((n) => run.steps[n.id] === 'pending' && n.dependsOn.every((id) => run.steps[id] === 'done'));
}
export function parseOutcome(output: string): { outcome: Outcome; summary: string } {
  const lines = output.trim().split('\n');
  const marker = lines.at(-1)?.startsWith('GANTRY_RESULT ') ? lines.at(-1) : undefined;
  if (!marker) throw new Error('Agent did not return a structured handover. Review its output, then retry.');
  const result = JSON.parse(marker.slice('GANTRY_RESULT '.length));
  if (!['done', 'changes_requested', 'waiting', 'failed'].includes(result.outcome) || typeof result.summary !== 'string' || !result.summary.trim())
    throw new Error('Agent returned an invalid handover.');
  return { outcome: result.outcome, summary: result.summary.slice(0, 12000) };
}
/** Reset the correction target and every dependent, retaining all attempt history. */
export function resetFrom(run: Execution, target: string) {
  if (!run.graph.nodes.some((n) => n.id === target)) throw new Error('Unknown correction target.');
  const reset = new Set([target]);
  for (let pass = 0; pass < run.graph.nodes.length; pass++) for (const n of run.graph.nodes) if (n.dependsOn.some((id) => reset.has(id))) reset.add(n.id);
  for (const id of reset) run.steps[id] = 'pending';
}
export function finishAttempt(run: Execution, attempt: Attempt, outcome: Outcome, summary: string) {
  attempt.state = outcome;
  attempt.summary = summary;
  attempt.endedAt = Date.now();
  const node = run.graph.nodes.find((n) => n.id === attempt.nodeId)!;
  run.message = summary;
  if (outcome === 'done') {
    run.steps[node.id] = 'done';
    if (run.graph.nodes.every((n) => run.steps[n.id] === 'done')) run.state = 'complete';
  } else if (outcome === 'changes_requested' && node.retryTarget) {
    const target = run.graph.nodes.find((n) => n.id === node.retryTarget)!;
    const count = run.attempts.filter((a) => a.nodeId === target.id).length;
    if (count < (target.maxAttempts ?? 3)) resetFrom(run, target.id);
    else {
      run.steps[node.id] = 'failed';
      run.state = 'waiting';
      run.message = `Retry limit reached for ${target.label}. ${summary}`;
    }
  } else {
    run.steps[node.id] = outcome === 'waiting' ? 'waiting' : 'failed';
    run.state = 'waiting';
  }
}
