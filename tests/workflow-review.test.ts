import { describe, expect, test } from 'vitest';
import { reviewTicket, reviewFeedback, restartWithReview, validateReviewRestart } from '../desktop/src/lib/server/workflow-review';
import type { Execution } from '../desktop/src/lib/server/workflow-state';
import type { Space, CommentsResponse } from '../desktop/src/lib/types';

const targetId = 'acme/app/pull/42';
const space: Space = {
  id: 'space',
  name: 'Ticket',
  targets: [targetId],
  active: targetId,
  files: {},
  updatedAt: 1,
  gantry: { ticketId: 'ticket', projectId: 'project', workspace: '/fixture/workspace' },
};
const comments: CommentsResponse = {
  general: [{ id: 1, author: 'reviewer', body: 'Please fix validation', createdAt: '2026-01-01', url: 'https://github.com/acme/app/pull/42#issuecomment-1' }],
  threads: [
    {
      id: 'gh-2',
      file: 'src/input.ts',
      start: 5,
      end: 8,
      side: 'new',
      outdated: true,
      comments: [{ id: 2, author: 'reviewer', body: 'Handle empty input', createdAt: '2026-01-02', url: 'https://github.com/acme/app/pull/42#discussion_r2' }],
    },
  ],
};

function fixture(edges = false): Execution {
  return {
    ticketId: 'ticket',
    projectId: 'project',
    state: 'complete',
    message: 'Done',
    updatedAt: 10,
    defaultProviderId: 'codex',
    steps: { plan: 'done', build: 'done', review: 'done', other: 'done' },
    attempts: [],
    deliverables: [{ repo: 'app', url: `https://github.com/${targetId}`, title: 'Change', nodeId: 'build', at: 1 }],
    graph: {
      nodes: [
        { id: 'plan', label: 'Plan', kind: 'agent', instructions: '', dependsOn: [] },
        { id: 'build', label: 'Implement', kind: 'agent', instructions: '', dependsOn: ['plan'] },
        { id: 'review', label: 'Review', kind: 'agent', instructions: '', dependsOn: ['build'] },
        { id: 'other', label: 'Other', kind: 'agent', instructions: '', dependsOn: [] },
      ],
      ...(edges
        ? {
            entryNodeId: 'plan',
            edges: [
              { id: 'a', source: 'plan', target: 'build', label: '' },
              { id: 'b', source: 'build', target: 'review', label: '' },
              { id: 'c', source: 'review', target: 'build', label: 'Correct' },
            ],
          }
        : {}),
    },
  };
}

describe('review correction loop', () => {
  test('requires an unambiguous, active ticket association and respects the current space', () => {
    expect(reviewTicket([space], targetId).ticketId).toBe('ticket');
    expect(reviewTicket([space, { ...space, id: 'personal', gantry: undefined }], targetId, 'personal').ticketId).toBe('ticket');
    const second = { ...space, id: 'second', gantry: { ...space.gantry!, ticketId: 'second-ticket' } };
    expect(() => reviewTicket([space, second], targetId)).toThrow('Open this PR');
    expect(reviewTicket([space, second], targetId, 'space').ticketId).toBe('ticket');
    expect(() => reviewTicket([space], targetId, 'wrong')).toThrow('no active ticket');
    expect(() => reviewTicket([{ ...space, gantry: { ...space.gantry!, completed: true } }], targetId)).toThrow('no active ticket');
    expect(() => reviewTicket([space], '../bad')).toThrow('Choose a pull');
  });

  test('captures source links, locations, discussion and explicit user direction as bounded data', () => {
    const feedback = reviewFeedback(targetId, comments, [{ id: 'm', role: 'user', text: 'Keep the API stable', ts: 5, anchor: null }], 'Add a regression test');
    const text = JSON.stringify(feedback);
    for (const expected of ['validation', 'src/input.ts:5-8', 'outdated', 'discussion_r2', 'Keep the API stable', 'Add a regression test'])
      expect(text).toContain(expected);
    const many = { ...comments, general: Array.from({ length: 100 }, (_, id) => ({ ...comments.general[0], id, body: 'x'.repeat(100000) })) };
    const bounded = reviewFeedback(targetId, many, [], 'y'.repeat(100000));
    expect(JSON.stringify(bounded).length).toBeLessThan(29000);
    expect(bounded.omitted).toBeGreaterThan(0);
  });

  test('rejects stale, unconfirmed, active, invalid and dependency-blocked restarts before mutating', () => {
    const run = fixture();
    const request = { targetId, expectedUpdatedAt: 10, confirm: true };
    expect(() => validateReviewRestart(run, 'build', request)).not.toThrow();
    expect(() => validateReviewRestart(run, 'missing', request)).toThrow('Choose a stage');
    expect(() => validateReviewRestart(run, 'build', { ...request, confirm: false })).toThrow('Confirm');
    expect(() => validateReviewRestart(run, 'build', { ...request, expectedUpdatedAt: 9 })).toThrow('changed');
    run.state = 'running';
    expect(() => validateReviewRestart(run, 'build', request)).toThrow('Pause');
    run.state = 'paused';
    run.steps.plan = 'pending';
    expect(() => validateReviewRestart(run, 'build', request)).toThrow('prerequisites');
    expect(run.steps.build).toBe('done');
  });

  test.each([false, true])('resets a completed graph with explicit edges=%s while retaining history and durable feedback', (edges) => {
    const run = fixture(edges);
    run.routing = { nodeId: 'review', outcome: 'done', summary: 'Old routing' };
    run.decision = { nodeId: 'review', question: 'Old?', options: [], source: 'stage', at: 1 };
    run.blocked = { nodeId: 'review', rules: [], alreadyAllowed: [], at: 1 };
    run.waitKey = 'stale';
    const before = JSON.stringify(run.deliverables);
    for (let i = 0; i < 5; i++) restartWithReview(run, 'build', reviewFeedback(targetId, comments, [], `Loop ${i}`));
    const restored = JSON.parse(JSON.stringify(run)) as Execution;
    expect(restored.steps).toEqual({ plan: 'done', build: 'pending', review: 'pending', other: 'done' });
    expect(restored.state).toBe('running');
    expect(restored.routing).toBeUndefined();
    expect(restored.decision).toBeUndefined();
    expect(restored.blocked).toBeUndefined();
    expect(restored.waitKey).toBeUndefined();
    expect(JSON.stringify(restored.deliverables)).toBe(before);
    expect(restored.reviewFeedback).toHaveLength(3);
    expect(restored.reviewFeedback?.at(-1)?.note).toBe('Loop 4');
    expect(restored.activeNodeId).toBe(edges ? 'build' : undefined);
  });

  test('allows another attempt for every exhausted downstream stage without discarding its history', () => {
    const run = fixture();
    run.attempts = ['build', 'review', 'other'].flatMap((nodeId) =>
      Array.from({ length: 4 }, (_, index) => ({
        id: `${nodeId}-${index}`,
        nodeId,
        state: 'done' as const,
        startedAt: index,
        summary: 'Previous attempt',
        output: '',
        providerId: 'codex',
        providerKind: 'codex' as const,
        model: 'default',
        commits: {},
      })),
    );
    const history = structuredClone(run.attempts);

    restartWithReview(run, 'build', reviewFeedback(targetId, comments, [], 'Address review'));

    expect(run.graph.nodes.find((node) => node.id === 'build')?.maxAttempts).toBe(5);
    expect(run.graph.nodes.find((node) => node.id === 'review')?.maxAttempts).toBe(5);
    expect(run.graph.nodes.find((node) => node.id === 'other')?.maxAttempts).toBeUndefined();
    expect(run.attempts).toEqual(history);
  });
});
