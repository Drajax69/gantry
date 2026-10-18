import { createHash } from 'node:crypto';

export interface CodexThread {
  status?: { type: string };
  turns?: { id: string; status: string; items: { type: string; text?: string; phase?: string }[] }[];
}
/** Never use an earlier successful turn while a newer user turn is unfinished. */
export function chatSnapshot(thread: CodexThread) {
  const turn = thread?.turns?.at(-1);
  if (!turn) throw new Error('Codex has not exposed the stage conversation yet. Retry once its history is available.');
  const messages = turn.items.filter((i) => i.type === 'agentMessage');
  const output = messages
    .filter((i) => i.phase !== 'commentary')
    .map((i) => i.text || '')
    .join('\n\n');
  const active = turn.status === 'inProgress' || thread.status?.type === 'active';
  const version = createHash('sha256').update(JSON.stringify(turn)).digest('hex');
  return { active, version, output, complete: turn.status === 'completed' };
}

export async function waitForChatHandover(read: () => Promise<CodexThread>, signal: AbortSignal, delay: () => Promise<void>) {
  let previous = '';
  while (true) {
    signal.throwIfAborted();
    const snapshot = chatSnapshot(await read());
    if (!snapshot.active && snapshot.version === previous) {
      if (!snapshot.complete) throw new Error('The external stage chat stopped without completing. Check its chat before retrying.');
      return snapshot;
    }
    previous = snapshot.active ? '' : snapshot.version;
    await delay();
  }
}

/** Read only complete JSONL records; another process may be appending the tail. */
export function rolloutThread(contents: string): CodexThread {
  const turns: NonNullable<CodexThread['turns']> = [];
  for (const line of contents.slice(0, contents.lastIndexOf('\n') + 1).split('\n')) {
    if (!line) continue;
    const row = JSON.parse(line);
    const event = row.payload;
    if (row.type === 'event_msg' && event?.type === 'task_started') {
      turns.push({ id: event.turn_id, status: 'inProgress', items: [] });
    } else if (row.type === 'event_msg' && ['task_complete', 'turn_aborted'].includes(event?.type)) {
      const turn = turns.findLast((t) => t.id === event.turn_id);
      if (!turn) continue;
      turn.status = event.type === 'task_complete' ? 'completed' : 'interrupted';
      if (typeof event.last_agent_message === 'string') turn.items = [{ type: 'agentMessage', phase: 'final_answer', text: event.last_agent_message }];
    } else if (row.type === 'response_item' && event?.type === 'message' && event.role === 'user' && turns.at(-1)?.status === 'completed') {
      // A submitted follow-up can precede its task_started record.
      turns.push({ id: 'pending-user-turn', status: 'inProgress', items: [] });
    }
  }
  return { turns };
}
