import { describe, expect, test } from 'vitest';
import { finishAttempt, nextNode, parseOutcome, resetFrom, type Execution, type Attempt } from '../desktop/src/lib/server/workflow-state';
import { workflowSchema } from '../packages/shared/src/workflow';
function fixture(): Execution {
  return {
    ticketId: 'ticket',
    projectId: 'project',
    state: 'running',
    message: '',
    defaultProviderId: 'codex',
    updatedAt: 0,
    attempts: [],
    steps: { plan: 'pending', build: 'pending', test: 'pending', review: 'pending' },
    graph: {
      nodes: [
        { id: 'plan', label: 'Plan', instructions: '', kind: 'agent', dependsOn: [] },
        { id: 'build', label: 'Build', instructions: '', kind: 'agent', dependsOn: ['plan'], maxAttempts: 2 },
        { id: 'test', label: 'Test', instructions: '', kind: 'agent', dependsOn: ['build'] },
        { id: 'review', label: 'Review', instructions: '', kind: 'agent', dependsOn: ['build', 'test'], retryTarget: 'build' },
      ],
    },
  };
}
function attempt(run: Execution, nodeId: string): Attempt {
  const a: Attempt = {
    id: String(run.attempts.length),
    nodeId,
    startedAt: 0,
    state: 'running',
    summary: '',
    output: '',
    providerId: 'codex',
    providerKind: 'codex',
    model: 'test',
    commits: {},
  };
  run.attempts.push(a);
  run.steps[nodeId] = 'running';
  return a;
}
describe('automatic stage handovers', () => {
  test('advances dependencies and completes only after all stages', () => {
    const r = fixture();
    for (const id of ['plan', 'build', 'test', 'review']) {
      expect(nextNode(r)?.id).toBe(id);
      finishAttempt(r, attempt(r, id), 'done', 'Validated');
    }
    expect(nextNode(r)).toBeUndefined();
    expect(r.state).toBe('complete');
  });
  test('correction reopens implementation and every dependent, preserving history', () => {
    const r = fixture();
    for (const id of ['plan', 'build', 'test']) finishAttempt(r, attempt(r, id), 'done', 'Completed');
    finishAttempt(r, attempt(r, 'review'), 'changes_requested', 'Missing edge case');
    expect(r.steps).toEqual({ plan: 'done', build: 'pending', test: 'pending', review: 'pending' });
    expect(nextNode(r)?.id).toBe('build');
    expect(r.attempts).toHaveLength(4);
    expect(r.attempts.at(-1)?.summary).toBe('Missing edge case');
    for (const id of ['build', 'test']) finishAttempt(r, attempt(r, id), 'done', 'Corrected');
    finishAttempt(r, attempt(r, 'review'), 'changes_requested', 'Still fails');
    expect(r.state).toBe('waiting');
    expect(r.message).toContain('Retry limit');
  });
  test.each(['waiting', 'failed', 'changes_requested'] as const)('stops on %s without a correction route', (outcome) => {
    const r = fixture();
    finishAttempt(r, attempt(r, 'plan'), outcome, 'Need input');
    expect(r.state).toBe('waiting');
    expect(nextNode(r)).toBeUndefined();
  });
  test('manual retry resets downstream nodes but leaves unrelated work intact', () => {
    const r = fixture();
    r.steps = { plan: 'done', build: 'done', test: 'done', review: 'done' };
    resetFrom(r, 'test');
    expect(r.steps).toEqual({ plan: 'done', build: 'done', test: 'pending', review: 'pending' });
    expect(() => resetFrom(r, 'missing')).toThrow();
  });
  test('requires an explicit valid result instead of treating any agent answer as success', () => {
    expect(parseOutcome('GANTRY_RESULT {"outcome":"done","summary":"Drafted","finalNotes":" https://docs.example.com/d/x "}').finalNotes).toBe('https://docs.example.com/d/x');
    expect(parseOutcome('GANTRY_RESULT {"outcome":"done","summary":"Drafted","finalNotes":"  "}').finalNotes).toBeUndefined();
    expect(() => parseOutcome('All done!')).toThrow();
    expect(() => parseOutcome('GANTRY_RESULT {"outcome":"done","summary":""}')).toThrow();
    expect(() => parseOutcome('GANTRY_RESULT {"outcome":"merged","summary":"x"}')).toThrow();
    expect(parseOutcome('progress\nGANTRY_RESULT {"outcome":"done","summary":"Tests passed"}')).toEqual({ outcome: 'done', summary: 'Tests passed' });
  });
  test('validates node execution settings and correction ancestry', () => {
    const graph = fixture().graph;
    expect(workflowSchema.safeParse(graph).success).toBe(true);
    graph.nodes[0].retryTarget = 'review';
    expect(workflowSchema.safeParse(graph).success).toBe(false);
    delete graph.nodes[0].retryTarget;
    graph.nodes[1].maxAttempts = 0;
    expect(workflowSchema.safeParse(graph).success).toBe(false);
  });
});
