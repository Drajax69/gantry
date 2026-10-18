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
  activeNodeId?: string;
  routing?: { nodeId: string; outcome: Outcome; summary: string };
  coordinatorSessionId?: string;
  routes?: { edgeId: string | null; reason: string; at: number }[];
  replies?: { nodeId: string; message: string; at: number }[];
}
export function nextNode(run: Execution) {
  if (run.graph.edges !== undefined) return run.graph.nodes.find((n) => n.id === (run.activeNodeId || run.graph.entryNodeId) && run.steps[n.id] === 'pending');
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
  for (let pass = 0; pass < run.graph.nodes.length; pass++)
    for (const n of run.graph.nodes)
      if (run.graph.edges !== undefined ? run.graph.edges.some((e) => e.target === n.id && reset.has(e.source)) : n.dependsOn.some((id) => reset.has(id)))
        reset.add(n.id);
  for (const id of reset) run.steps[id] = 'pending';
}
export function finishAttempt(run: Execution, attempt: Attempt, outcome: Outcome, summary: string) {
  attempt.state = outcome;
  attempt.summary = summary;
  attempt.endedAt = Date.now();
  const node = run.graph.nodes.find((n) => n.id === attempt.nodeId)!;
  run.message = summary;
  if (run.graph.edges !== undefined) {
    run.steps[node.id] = outcome === 'done' ? 'done' : outcome === 'waiting' ? 'waiting' : 'failed';
    if (outcome === 'done' || outcome === 'changes_requested') run.routing = { nodeId: node.id, outcome, summary };
    else run.state = 'waiting';
    return;
  }
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

/** Only configured paths from completed work can be taken; arbitrary node IDs never execute. */
export function applyRoute(run: Execution, output: string) {
  const line = output.trim().split('\n').at(-1);
  if (!line?.startsWith('GANTRY_ROUTE ')) throw new Error('Coordinator did not return a routing decision. Resume to retry routing.');
  const decision = JSON.parse(line.slice('GANTRY_ROUTE '.length));
  if (typeof decision.reason !== 'string' || !decision.reason.trim() || decision.reason.length > 12000)
    throw new Error('Coordinator returned an invalid routing reason.');
  if (decision.wait === true) {
    run.state = 'waiting';
    run.message = decision.reason;
    return;
  }
  const current = run.routing;
  if (!current) throw new Error('No handover is awaiting routing.');
  if (decision.edgeId === null) {
    if (current.outcome !== 'done' || run.graph.edges?.some((e) => e.source === current.nodeId))
      throw new Error('Coordinator cannot finish before a terminal node completes.');
    run.state = 'complete';
    run.message = decision.reason;
    run.routing = undefined;
  } else {
    const edge = run.graph.edges?.find((e) => e.id === decision.edgeId);
    if (!edge || !(run.steps[edge.source] === 'done' || edge.source === current.nodeId)) throw new Error('Coordinator selected an unavailable connection.');
    if (current.outcome === 'changes_requested' && edge.source !== current.nodeId)
      throw new Error('Corrections must follow a connection from the node requesting changes.');
    const target = run.graph.nodes.find((n) => n.id === edge.target)!;
    if (run.attempts.filter((a) => a.nodeId === target.id).length >= (target.maxAttempts ?? 3)) {
      run.state = 'waiting';
      run.message = `Visit limit reached for ${target.label}. ${decision.reason}`;
      return;
    }
    if (run.attempts.some((a) => a.nodeId === target.id)) resetFrom(run, target.id);
    run.steps[target.id] = 'pending';
    run.activeNodeId = target.id;
    run.routing = undefined;
    run.state = 'running';
    run.message = decision.reason;
  }
  run.routes ??= [];
  run.routes.push({ edgeId: decision.edgeId, reason: decision.reason, at: Date.now() });
}
