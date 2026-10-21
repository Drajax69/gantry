import { createHash } from 'node:crypto';
import { chatSnapshot, rolloutThread } from './workflow-chat-state';

/** What a person said in a stage chat, and the agent's latest complete answer there. */
export interface StageTranscript {
  userMessages: { text: string; at: number }[];
  /** The latest finished answer, or null while a turn is still running. */
  finalOutput: string | null;
  version: string;
}

const MAX_MESSAGE = 4000;
// Tool output, slash-command plumbing and harness notes are not things the person typed.
const notTyped = (text: string) => !text || text.startsWith('<') || text.startsWith('Caveat:') || text.startsWith('[Request interrupted');
const time = (value: unknown) => {
  const at = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(at) ? at : 0;
};
const versionOf = (parts: unknown) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');

type ClaudeBlock = { type?: string; text?: string };
interface ClaudeRow {
  type?: string;
  timestamp?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  isCompactSummary?: boolean;
  message?: { role?: string; content?: string | ClaudeBlock[] };
}

/** Claude Code session transcript (`~/.claude/projects/<dir>/<session>.jsonl`). */
export function parseClaudeTranscript(contents: string): StageTranscript {
  const rows: ClaudeRow[] = [];
  // Only complete lines: the CLI may be appending the tail.
  for (const line of contents.slice(0, contents.lastIndexOf('\n') + 1).split('\n')) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      /* A malformed line is skipped rather than failing the whole read. */
    }
  }
  const userMessages: StageTranscript['userMessages'] = [];
  let lastUser = -1;
  rows.forEach((row, index) => {
    if (row.type !== 'user' || row.isMeta || row.isSidechain || row.isCompactSummary) return;
    const content = row.message?.content;
    const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
    if (blocks.some((b) => b.type === 'tool_result')) return;
    const text = blocks
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('\n')
      .trim();
    if (notTyped(text)) return;
    userMessages.push({ text: text.slice(0, MAX_MESSAGE), at: time(row.timestamp) });
    lastUser = index;
  });
  const answer = rows
    .slice(lastUser + 1)
    .filter((row) => row.type === 'assistant' && !row.isSidechain)
    .flatMap((row) => (Array.isArray(row.message?.content) ? row.message.content : []))
    .filter((b) => b.type === 'text' && b.text?.trim())
    .map((b) => b.text!.trim())
    .join('\n\n');
  const finalOutput = answer || null;
  return { userMessages, finalOutput, version: versionOf([userMessages.length, userMessages.at(-1)?.at, finalOutput]) };
}

/** Codex rollout file for a thread. */
export function parseCodexRollout(contents: string): StageTranscript {
  const userMessages: StageTranscript['userMessages'] = [];
  for (const line of contents.slice(0, contents.lastIndexOf('\n') + 1).split('\n')) {
    if (!line.trim()) continue;
    let row: { timestamp?: string; type?: string; payload?: { type?: string; role?: string; content?: { type?: string; text?: string }[] } };
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const p = row.payload;
    if (row.type !== 'response_item' || p?.type !== 'message' || p.role !== 'user') continue;
    const text = (p.content ?? [])
      .filter((c) => c.type === 'input_text')
      .map((c) => c.text ?? '')
      .join('\n')
      .trim();
    if (notTyped(text)) continue;
    userMessages.push({ text: text.slice(0, MAX_MESSAGE), at: time(row.timestamp) });
  }
  let finalOutput: string | null = null;
  let version = versionOf([userMessages.length, userMessages.at(-1)?.at]);
  try {
    const snapshot = chatSnapshot(rolloutThread(contents));
    version = snapshot.version;
    if (!snapshot.active && snapshot.complete) finalOutput = snapshot.output || null;
  } catch {
    /* No turns yet. */
  }
  return { userMessages, finalOutput, version };
}

/** An `opencode export <session>` dump. It can print a line before the JSON, so parsing starts at the first brace. */
export function parseOpenCodeExport(contents: string): StageTranscript {
  type Part = { type?: string; text?: string; synthetic?: boolean };
  type Message = { info?: { role?: string; time?: { created?: number; completed?: number } }; parts?: Part[] };
  let messages: Message[] = [];
  try {
    messages = (JSON.parse(contents.slice(contents.indexOf('{'))) as { messages?: Message[] }).messages ?? [];
  } catch {
    /* Not an export: nothing to read. */
  }
  const textOf = (m: Message) => (m.parts ?? []).filter((p) => p.type === 'text' && !p.synthetic).map((p) => p.text ?? '').join('\n').trim();
  const userMessages: StageTranscript['userMessages'] = [];
  for (const m of messages) {
    if (m.info?.role !== 'user') continue;
    const text = textOf(m);
    if (!notTyped(text)) userMessages.push({ text: text.slice(0, MAX_MESSAGE), at: m.info.time?.created ?? 0 });
  }
  // The answer to the latest message: every assistant message after it, once the last one has finished.
  const lastUser = messages.map((m) => m.info?.role).lastIndexOf('user');
  const answer = messages.slice(lastUser + 1).filter((m) => m.info?.role === 'assistant');
  const finished = answer.length > 0 && !!answer.at(-1)!.info?.time?.completed;
  const finalOutput = finished ? answer.map(textOf).filter(Boolean).join('\n\n') || null : null;
  return { userMessages, finalOutput, version: versionOf([messages.length, answer.at(-1)?.info?.time?.completed ?? null]) };
}
