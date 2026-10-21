import type { Execution } from '../server/workflow-state';

export type NowTone = 'running' | 'waiting' | 'blocked' | 'failed' | 'paused' | 'done';
export interface NowAction {
  kind: 'allow' | 'retry' | 'resume' | 'reply' | 'decide';
  nodeId?: string;
  label: string;
}
export interface Now {
  nodeId?: string;
  tone: NowTone;
  text: string;
  action?: NowAction;
}

const label = (run: Execution, id?: string) => run.graph.nodes.find((n) => n.id === id)?.label ?? id ?? 'the graph';

/** Where the run is and the one action that moves it on. */
export function runNow(run: Execution): Now {
  const lastNode = run.attempts.at(-1)?.nodeId;
  const current = run.activeNodeId || lastNode || run.graph.entryNodeId;
  if (run.state === 'complete') return { tone: 'done', text: 'Complete' };
  if (run.state === 'running') {
    const runningNode = run.graph.nodes.find((n) => run.steps[n.id] === 'running')?.id;
    if (runningNode) return { nodeId: runningNode, tone: 'running', text: `${label(run, runningNode)} is running` };
    if (run.routing) return { nodeId: run.routing.nodeId, tone: 'running', text: `Choosing what follows ${label(run, run.routing.nodeId)}` };
    return { nodeId: current, tone: 'running', text: `Starting ${label(run, current)}` };
  }
  if (run.blocked)
    return {
      nodeId: run.blocked.nodeId,
      tone: 'blocked',
      text: `${label(run, run.blocked.nodeId)} needs access`,
      action: { kind: 'allow', nodeId: run.blocked.nodeId, label: `Allow and retry ${label(run, run.blocked.nodeId)}` },
    };
  if (run.decision) return { nodeId: run.decision.nodeId, tone: 'waiting', text: `${label(run, run.decision.nodeId)} needs your choice`, action: { kind: 'decide', label: 'Choose below' } };
  const waitingNode = run.graph.nodes.find((n) => run.steps[n.id] === 'waiting')?.id;
  if (waitingNode) return { nodeId: waitingNode, tone: 'waiting', text: `${label(run, waitingNode)} is waiting on your answer`, action: { kind: 'reply', label: 'Reply below' } };
  if (run.routing && run.state === 'waiting')
    return { nodeId: run.routing.nodeId, tone: 'waiting', text: `After ${label(run, run.routing.nodeId)}: waiting on you`, action: { kind: 'reply', label: 'Reply below' } };
  // Older runs said Terminal; chats now open in herdr.
  if (/still open in (Terminal|herdr)/.test(run.message))
    return { nodeId: current, tone: 'waiting', text: `${label(run, current)} chat is still open`, action: { kind: 'resume', label: 'Resume after closing the chat' } };
  const failedNode = [run.activeNodeId, lastNode, ...run.graph.nodes.map((n) => n.id)].find((id) => id && run.steps[id] === 'failed');
  if (failedNode)
    return { nodeId: failedNode, tone: 'failed', text: `${label(run, failedNode)} stopped`, action: { kind: 'retry', nodeId: failedNode, label: `Retry ${label(run, failedNode)}` } };
  if (run.state === 'paused') return { nodeId: current, tone: 'paused', text: `Paused at ${label(run, current)}`, action: { kind: 'resume', label: 'Resume' } };
  return { nodeId: current, tone: 'waiting', text: `Stopped at ${label(run, current)}`, action: { kind: 'resume', label: 'Resume' } };
}

export interface TimelineEntry {
  at: number;
  nodeId?: string;
  kind: 'stage' | 'route' | 'you' | 'event';
  tone?: NowTone;
  title: string;
  detail?: string;
}

const firstLine = (text: string, max = 220) => {
  const line = text.trim().split('\n')[0] ?? '';
  return line.length > max ? `${line.slice(0, max).trimEnd()}…` : line;
};
const outcomeTone = (state: string): NowTone =>
  state === 'done' ? 'done' : state === 'running' ? 'running' : state === 'waiting' || state === 'changes_requested' ? 'waiting' : 'failed';
const outcomeText: Record<string, string> = {
  done: 'finished',
  changes_requested: 'asked for changes',
  waiting: 'asked you',
  failed: 'failed',
  interrupted: 'was interrupted',
  running: 'is running',
};

/** Everything that happened in the run, newest first, across all stages. */
export function runTimeline(run: Execution): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  const visits = new Map<string, number>();
  for (const a of run.attempts) {
    const n = (visits.get(a.nodeId) ?? 0) + 1;
    visits.set(a.nodeId, n);
    const name = `${label(run, a.nodeId)}${n > 1 ? ` (run ${n})` : ''}`;
    const refused = a.denials?.length ? ` Refused: ${[...new Set(a.denials.map((d) => d.rule))].join(', ')}.` : '';
    if (a.state === 'running') entries.push({ at: a.startedAt, nodeId: a.nodeId, kind: 'stage', tone: 'running', title: `${name} is running` });
    else
      entries.push({
        at: a.endedAt ?? a.startedAt,
        nodeId: a.nodeId,
        kind: 'stage',
        tone: outcomeTone(a.state),
        title: `${name} ${outcomeText[a.state] ?? a.state}`,
        detail: `${firstLine(a.summary)}${refused}`.trim() || undefined,
      });
  }
  for (const r of run.routes ?? []) {
    const edge = run.graph.edges?.find((e) => e.id === r.edgeId);
    entries.push({
      at: r.at,
      nodeId: edge?.target,
      kind: 'route',
      title: edge ? `${label(run, edge.source)} → ${label(run, edge.target)}` : 'Graph finished',
      detail: firstLine(r.reason),
    });
  }
  for (const r of run.replies ?? []) {
    const via = r.source === 'chat' ? 'in the stage chat' : r.source === 'choice' ? 'chose' : 'replied';
    entries.push({ at: r.at, nodeId: r.nodeId, kind: 'you', title: `You ${via} · ${label(run, r.nodeId)}`, detail: firstLine(r.message) });
  }
  for (const e of run.events ?? []) {
    // Replies and choices are already listed from their own records.
    if (['decide', 'confirm'].includes(e.kind)) continue;
    const tone: NowTone | undefined = e.kind === 'blocked' ? 'blocked' : e.kind === 'pause' ? 'paused' : ['interrupted', 'limit', 'denied'].includes(e.kind) ? 'failed' : undefined;
    entries.push({ at: e.at, nodeId: e.nodeId, kind: 'event', tone, title: firstLine(e.text, 160) });
  }
  return entries.sort((a, b) => b.at - a.at);
}
