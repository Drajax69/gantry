import 'server-only';
import type { Execution } from './workflow-state';

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/**
 * A compact, readable view of a ticket's run for its master chat: each stage's state and latest
 * handover, what the run is waiting on, and the PRs it delivered. Stage outputs are left out; they
 * can be hundreds of kilobytes.
 */
export function summarizeExecution(run: Execution) {
  const latest = (nodeId: string) => [...run.attempts].reverse().find((a) => a.nodeId === nodeId);
  return {
    state: run.state,
    message: run.message,
    activeStage: run.activeNodeId,
    stages: run.graph.nodes.map((n) => {
      const attempt = latest(n.id);
      return {
        id: n.id,
        name: n.label,
        kind: n.kind,
        state: run.steps[n.id],
        attempts: run.attempts.filter((a) => a.nodeId === n.id).length,
        ...(attempt ? { lastOutcome: attempt.state, lastSummary: clip(attempt.summary, 1500), lastEndedAt: attempt.endedAt } : {}),
      };
    }),
    connections: run.graph.edges?.map((e) => ({ id: e.id, from: e.source, to: e.target, condition: e.label })),
    ...(run.decision ? { decision: { stage: run.decision.nodeId, question: run.decision.question, options: run.decision.options.map((o) => ({ id: o.id, label: o.label })) } } : {}),
    ...(run.blocked ? { blocked: { stage: run.blocked.nodeId, refusedTools: run.blocked.rules } } : {}),
    recentReplies: (run.replies ?? []).slice(-10).map((r) => ({ stage: r.nodeId, message: clip(r.message, 500), source: r.source })),
    pullRequests: (run.deliverables ?? []).map((d) => ({ repo: d.repo, url: d.url, title: d.title })),
  };
}
