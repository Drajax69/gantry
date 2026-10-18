import { test, expect } from 'vitest';
import { chatSnapshot, waitForChatHandover, type CodexThread } from '../desktop/src/lib/server/workflow-chat-state';
const thread = (id: string, status: string, text = '', type = 'notLoaded'): CodexThread => ({
  status: { type },
  turns: [{ id, status, items: [{ type: 'agentMessage', phase: 'final_answer', text }] }],
});
test('waits through a follow-up and returns its handover instead of the original turn', async () => {
  const first = thread('original', 'completed', 'old');
  const latest = thread('followup', 'completed', 'GANTRY_RESULT {"outcome":"done","summary":"new changes"}');
  const snapshots = [first, thread('followup', 'inProgress'), latest, latest];
  let count = 0;
  const result = await waitForChatHandover(
    async () => snapshots[count++],
    new AbortController().signal,
    async () => {},
  );
  expect(count).toBe(4);
  expect(result.output).toContain('new changes');
});
test('opening and observing an unchanged completed conversation does not change its handover', async () => {
  const snapshot = thread('one', 'completed', 'handover');
  const result = await waitForChatHandover(
    async () => snapshot,
    new AbortController().signal,
    async () => {},
  );
  expect(result.output).toBe('handover');
});
test('active thread status overrides persisted completion and missing/interrupted history fails closed', async () => {
  expect(chatSnapshot(thread('one', 'completed', '', 'active')).active).toBe(true);
  expect(() => chatSnapshot({})).toThrow('not exposed');
  await expect(
    waitForChatHandover(
      async () => thread('one', 'interrupted'),
      new AbortController().signal,
      async () => {},
    ),
  ).rejects.toThrow('without completing');
});
test('pausing cancels waiting for the external conversation', async () => {
  const abort = new AbortController();
  await expect(
    waitForChatHandover(
      async () => thread('one', 'inProgress'),
      abort.signal,
      async () => {
        abort.abort();
      },
    ),
  ).rejects.toThrow();
});

test('durable task events distinguish live CLI turns from interrupted app-server snapshots', async () => {
  const { rolloutThread } = await import('../desktop/src/lib/server/workflow-chat-state');
  const event = (payload: object) => JSON.stringify({ type: 'event_msg', payload }) + '\n';
  const start = event({ type: 'task_started', turn_id: 'one' });
  expect(chatSnapshot(rolloutThread(start)).active).toBe(true);
  const done = start + event({ type: 'task_complete', turn_id: 'one', last_agent_message: 'handover' });
  expect(chatSnapshot(rolloutThread(done)).output).toBe('handover');
  expect(chatSnapshot(rolloutThread(done + '{"partial":')).complete).toBe(true);
  const followup = done + JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user' } }) + '\n';
  expect(chatSnapshot(rolloutThread(followup)).active).toBe(true);
  expect(chatSnapshot(rolloutThread(followup + event({ type: 'task_started', turn_id: 'two' }))).active).toBe(true);
  expect(chatSnapshot(rolloutThread(start + event({ type: 'turn_aborted', turn_id: 'one' }))).complete).toBe(false);
});
