import type { ChatMessage, CommentsResponse, Space } from '../types';
import { resetFrom, type Execution } from './workflow-state';

export interface ReviewRestart {
  targetId: string;
  spaceId?: string;
  expectedUpdatedAt: number;
  confirm: boolean;
}

/** A target can appear in several spaces; never guess which ticket should run. */
export function reviewTicket(spaces: Space[], targetId: string, spaceId?: string) {
  if (!/^[\w.-]+\/[\w.-]+\/pull\/[1-9]\d*$/.test(targetId)) throw new Error('Choose a pull request review.');

  const current = spaceId
    ? spaces.find((s) => s.id === spaceId && s.targets.includes(targetId) && !s.gantry?.completed)
    : undefined;

  if (spaceId && !current) throw new Error('This PR has no active ticket review space. Reload the review.');

  const matches = spaces.filter(
    (s) => (!current?.gantry || s.id === spaceId) && s.targets.includes(targetId) && s.gantry && !s.gantry.completed,
  );
  const tickets = new Set(matches.map((s) => s.gantry!.ticketId));

  if (tickets.size !== 1)
    throw new Error(
      tickets.size
        ? 'Open this PR in its ticket review space to choose the workflow.'
        : 'This PR has no active ticket review space. Move its ticket into In progress first.',
    );
  return matches[0].gantry!;
}

/** Bounded, durable data shared by every stage and coordinator in the correction loop. */
export function reviewFeedback(targetId: string, comments: CommentsResponse, messages: ChatMessage[], note: string) {
  const entries = [
    ...comments.general.map((c) => ({ ...c, location: 'General review' })),
    ...comments.threads.flatMap((t) =>
      t.comments.map((c) => ({ ...c, location: `${t.file}:${t.start}-${t.end} (${t.side}${t.outdated ? ', outdated' : ''})` })),
    ),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let remaining = 24000;
  let omitted = 0;
  const bounded = (value: unknown) => {
    const text = JSON.stringify(value);
    if (text.length > remaining) {
      omitted++;
      return undefined;
    }
    remaining -= text.length;
    return value;
  };
  // Prefer recent feedback, but retain chronological order in the saved snapshot.
  const github = entries
    .slice()
    .reverse()
    .map((c) => bounded({ author: c.author, body: c.body.slice(0, 4000), url: c.url, at: c.createdAt, location: c.location }))
    .filter(Boolean)
    .reverse();
  const discussion = messages
    .slice(-30)
    .reverse()
    .map((m) => bounded({ role: m.role, text: m.text.slice(0, 3000), anchor: m.anchor, quote: m.quote, at: m.ts }))
    .filter(Boolean)
    .reverse();
  return {
    targetId,
    url: `https://github.com/${targetId}`,
    capturedAt: Date.now(),
    note: note.trim().slice(0, 4000),
    github,
    discussion,
    omitted: omitted + Math.max(0, messages.length - 30),
    bodiesMayBeTruncated: true,
  };
}

export type ReviewFeedback = ReturnType<typeof reviewFeedback> & { nodeId: string };

export function validateReviewRestart(run: Execution, nodeId: string, request: ReviewRestart) {
  if (request.confirm !== true) throw new Error('Confirm restarting the selected stage and its downstream stages.');
  if (run.updatedAt !== request.expectedUpdatedAt) throw new Error('The workflow changed. Reload the review graph before restarting.');
  if (run.state === 'running' || Object.values(run.steps).includes('running'))
    throw new Error('Pause the workflow and wait for its current stage to stop before restarting.');
  const node = run.graph.nodes.find((n) => n.id === nodeId);
  if (!node) throw new Error('Choose a stage in this execution graph.');
  if (run.graph.edges === undefined && node.dependsOn.some((id) => run.steps[id] !== 'done'))
    throw new Error('Complete the selected stage’s prerequisites first.');
}

export function restartWithReview(run: Execution, nodeId: string, feedback: ReturnType<typeof reviewFeedback>) {
  const reset = resetFrom(run, nodeId);

  for (const node of run.graph.nodes) {
    if (reset.has(node.id)) {
      const previousAttempts = run.attempts.filter((a) => a.nodeId === node.id).length;
      node.maxAttempts = Math.max(node.maxAttempts ?? 3, previousAttempts + 1);
    }
  }

  if (run.graph.edges !== undefined) run.activeNodeId = nodeId;
  run.routing = undefined;
  run.decision = undefined;
  run.blocked = undefined;
  run.waitKey = undefined;
  run.reviewFeedback = [...(run.reviewFeedback ?? []).slice(-2), { ...feedback, nodeId }];
  run.state = 'running';
  run.message = `Restarting ${run.graph.nodes.find((n) => n.id === nodeId)!.label} with PR review feedback from ${feedback.url}.`;
}
