import { afterAll, beforeEach, expect, test, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
const mocks = await vi.hoisted(async () => {
  const fs = await import('node:fs'),
    os = await import('node:os'),
    path = await import('node:path');
  return {
    home: fs.mkdtempSync(path.join(os.tmpdir(), 'gantry-runner-test-')),
    driver: vi.fn(),
    context: vi.fn(),
    conversation: vi.fn(),
    provider: vi.fn(),
    comments: vi.fn(),
    pending: vi.fn(),
  };
});
vi.mock('server-only', () => ({}));
vi.mock('../desktop/src/lib/server/exec', () => ({
  HOME: mocks.home,
  git: vi.fn().mockResolvedValue('ticket-branch'),
  withLock: (_: string, fn: () => unknown) => fn(),
}));
vi.mock('../desktop/src/lib/server/agents', () => ({
  drivers: { codex: mocks.driver, claude: mocks.driver, openai: mocks.driver },
  findAgent: mocks.provider,
  getAgent: () => ({ id: 'codex', kind: 'codex', model: 'default' }),
}));
vi.mock('../desktop/src/lib/server/ticket-chat', () => ({ ticketContext: mocks.context }));
vi.mock('../desktop/src/lib/server/ticket-conversations', () => ({ conversationFor: mocks.conversation, openWorkflowConversation: vi.fn() }));
vi.mock('../desktop/src/lib/server/spaces', () => ({
  listSpaces: () => ({ spaces: [{ id: 'review', targets: ['acme/app/pull/1'], gantry: { ticketId: 'test', projectId: 'project', workspace: mocks.home } }] }),
}));
vi.mock('../desktop/src/lib/server/comments', () => ({ getComments: mocks.comments }));
vi.mock('../desktop/src/lib/server/chats', () => ({ loadChat: () => ({ messages: [] }), pendingFor: mocks.pending, queuedFor: () => [] }));
vi.mock('../desktop/src/lib/server/stage-sessions', () => ({ sessionOpenInTerminal: async () => false }));
import { controlExecution, executionFor, tick } from '../desktop/src/lib/server/workflow-executor';
import { newWorkflow, type Workflow } from '../packages/shared/src/workflow';
const graph: Workflow = {
  nodes: [
    { id: 'plan', kind: 'agent', label: 'Plan', instructions: 'Make a plan', dependsOn: [], model: 'strong' },
    { id: 'build', kind: 'agent', label: 'Build', instructions: 'Implement', dependsOn: ['plan'], model: 'fast' },
  ],
};
const tickets = new Map<string, { id: string; projectId: string; status: string; workflow: ReturnType<typeof newWorkflow> }>();
const engine = () => (globalThis as any).workflowExecutor;
function add(id = 'test', g = graph) {
  tickets.set(id, { id, projectId: 'project', status: 'in_progress', workflow: newWorkflow(g) });
}
async function settled() {
  await vi.waitFor(() => expect(engine().active.size).toBe(0));
}
beforeEach(async () => {
  await settled();
  if (engine().timer) {
    clearInterval(engine().timer);
    engine().timer = undefined;
  }
  fs.rmSync(path.join(mocks.home, 'workflow-runs'), { recursive: true, force: true });
  fs.mkdirSync(path.join(mocks.home, 'workflow-runs'));
  tickets.clear();
  add();
  mocks.driver.mockReset();
  mocks.conversation.mockReset();
  mocks.comments.mockReset().mockResolvedValue({ threads: [], general: [] });
  mocks.pending.mockReset().mockReturnValue(null);
  mocks.provider.mockImplementation((id) => ({ id, kind: 'codex', model: 'default' }));
  mocks.context.mockImplementation(async (id) => ({
    ticket: { ...tickets.get(id), title: 'Fixture', description: 'Ticket instructions', branch: 'ticket-branch' },
    stagePrompt: 'Workspace conventions',
    project: { id: 'project', workspace: mocks.home },
    checkouts: [{ repositoryId: 'repo', path: mocks.home }],
  }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL) => ({
      ok: true,
      json: async () =>
        url.pathname === '/api/status'
          ? { tickets: [...tickets.values()] }
          : url.pathname.endsWith('/chat-prompt')
            ? { prompt: 'Workspace conventions' }
            : tickets.get(url.pathname.split('/')[3])?.workflow,
    })),
  );
  mocks.driver.mockImplementation(async (input) => {
    input.hooks.session(`session-${mocks.driver.mock.calls.length}`);
    input.hooks.text('GANTRY_RESULT {"outcome":"done","summary":"Validated locally"}');
  });
});
afterAll(async () => {
  await settled();
  clearInterval(engine().timer);
  engine().owner?.close();
  delete (globalThis as any).workflowExecutor;
  vi.unstubAllGlobals();
  fs.rmSync(mocks.home, { recursive: true, force: true });
});
test('runs node-specific models with separate chats and passes handovers automatically', async () => {
  await controlExecution('test', 'start');
  await vi.waitFor(() => expect(executionFor('test')?.steps.plan).toBe('done'));
  await settled();
  await tick();
  await settled();
  expect(executionFor('test')?.state).toBe('complete');
  expect(mocks.driver).toHaveBeenCalledTimes(2);
  const [a, b] = mocks.driver.mock.calls.map((c) => c[0]);
  expect(a.agent.model).toBe('strong');
  expect(b.agent.model).toBe('fast');
  expect(a.sessionId).toBeNull();
  expect(b.sessionId).toBeNull();
  expect(b.prompt).toContain('Validated locally');
  expect(b.system).toContain('Workspace conventions');
});
test('review restart persists refreshed feedback and rejects duplicates and failed refreshes without mutation', async () => {
  await controlExecution('test', 'start');
  await vi.waitFor(() => expect(executionFor('test')?.steps.plan).toBe('done'));
  await settled();
  await tick();
  await settled();
  const before = executionFor('test')!;
  const request = { targetId: 'acme/app/pull/1', spaceId: 'review', expectedUpdatedAt: before.updatedAt, confirm: true };
  mocks.comments.mockResolvedValueOnce({ threads: [], general: [], error: 'Offline' });
  await expect(controlExecution('test', 'review-restart', 'build', 'Fix comments', undefined, undefined, request)).rejects.toThrow(
    'Could not refresh PR feedback',
  );
  expect(executionFor('test')).toEqual(before);
  mocks.pending.mockReturnValueOnce({ id: 'active' });
  await expect(controlExecution('test', 'review-restart', 'build', '', undefined, undefined, request)).rejects.toThrow('agents to finish');
  expect(executionFor('test')).toEqual(before);
  await controlExecution('test', 'review-restart', 'build', 'Fix comments', undefined, undefined, request);
  await settled();
  await vi.waitFor(() => expect(executionFor('test')?.attempts.length).toBe(3));
  await settled();
  expect(executionFor('test')?.reviewFeedback?.[0].note).toBe('Fix comments');
  expect(mocks.comments).toHaveBeenLastCalledWith('acme/app/pull/1', true);
  expect(mocks.driver.mock.calls.at(-1)![0].prompt).toContain('Fix comments');
  await expect(controlExecution('test', 'review-restart', 'build', '', undefined, undefined, request)).rejects.toThrow('workflow changed');
  expect(executionFor('test')?.attempts.length).toBe(3);
});
test('pausing aborts active work and cannot dispatch its dependent stage', async () => {
  mocks.driver.mockImplementation((input) => new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true })));
  await controlExecution('test', 'start');
  await vi.waitFor(() => expect(mocks.driver).toHaveBeenCalledOnce());
  await controlExecution('test', 'pause');
  await settled();
  await tick();
  expect(executionFor('test')?.state).toBe('paused');
  expect(mocks.driver).toHaveBeenCalledOnce();
  expect(executionFor('test')?.attempts[0].state).toBe('interrupted');
});
test('malformed handovers stop and surface the agent output', async () => {
  mocks.driver.mockImplementation(async (input) => input.hooks.text('I think it worked'));
  await controlExecution('test', 'start');
  await vi.waitFor(() => expect(executionFor('test')?.state).toBe('waiting'));
  expect(executionFor('test')?.attempts[0].output).toBe('I think it worked');
  await tick();
  expect(mocks.driver).toHaveBeenCalledOnce();
});
test('recovers interrupted stages without silently replaying them', async () => {
  const record = {
    ticketId: 'test',
    projectId: 'project',
    graph,
    state: 'running',
    steps: { plan: 'running', build: 'pending' },
    attempts: [],
    defaultProviderId: 'codex',
    updatedAt: 0,
    message: '',
  };
  fs.writeFileSync(path.join(mocks.home, 'workflow-runs/test.json'), JSON.stringify(record));
  await tick();
  expect(executionFor('test')?.state).toBe('waiting');
  expect(executionFor('test')?.message).toContain('restarted');
  expect(mocks.driver).not.toHaveBeenCalled();
});
test('workspace-exclusive stages wait while another ticket is writing', async () => {
  add('second', { nodes: [{ ...graph.nodes[0], workspaceExclusive: true }] });
  let finish!: () => void;
  mocks.driver.mockImplementation(
    (input) =>
      new Promise<void>((resolve) => {
        finish = () => {
          input.hooks.text('GANTRY_RESULT {"outcome":"done","summary":"ok"}');
          resolve();
        };
      }),
  );
  await controlExecution('test', 'start');
  await vi.waitFor(() => expect(mocks.driver).toHaveBeenCalledOnce());
  await controlExecution('second', 'start');
  await tick();
  expect(mocks.driver).toHaveBeenCalledOnce();
  await controlExecution('test', 'pause');
  finish();
  await vi.waitFor(() => expect(executionFor('test')?.attempts[0]?.state).toBe('interrupted'));
  await tick();
  await vi.waitFor(() => expect(mocks.driver).toHaveBeenCalledTimes(2));
  finish();
  await settled();
  expect(executionFor('second')?.state).toBe('complete');
});
test('does not auto-start an existing external conversation', async () => {
  add('test', { ...graph, autoStart: true });
  mocks.conversation.mockReturnValue({ sessionId: 'external' });
  await tick();
  expect(mocks.driver).not.toHaveBeenCalled();
  await expect(controlExecution('test', 'start')).rejects.toThrow('external coding chat');
});

test('runs ten independent tickets and queues the eleventh', async () => {
  tickets.clear();
  for (let i = 0; i < 11; i++) add(`parallel-${i}`, { autoStart: true, nodes: [graph.nodes[0]] });
  const finishers: (() => void)[] = [];
  mocks.driver.mockImplementation(
    (input) =>
      new Promise<void>((resolve) => {
        finishers.push(() => {
          input.hooks.text('GANTRY_RESULT {"outcome":"done","summary":"Finished"}');
          resolve();
        });
      }),
  );
  await tick();
  await vi.waitFor(() => expect(mocks.driver).toHaveBeenCalledTimes(10));
  expect(engine().active.size).toBe(10);
  expect([...tickets.keys()].map((id) => executionFor(id)).filter((r) => r?.steps.plan === 'pending')).toHaveLength(1);
  for (const finish of finishers) finish();
  await settled();
  await tick();
  await vi.waitFor(() => expect(mocks.driver).toHaveBeenCalledTimes(11));
  finishers.at(-1)!();
  await settled();
  expect([...tickets.keys()].every((id) => executionFor(id)?.state === 'complete')).toBe(true);
});
