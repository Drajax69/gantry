import type { Anchor, ChatMessage } from "@/lib/types";

/** A question about some lines (or the whole change) and everything said after it. */
export interface Thread {
  id: string;
  anchor: Anchor | null;
  messages: ChatMessage[];
  /** The answer streaming in right now, if it belongs here. */
  pending: ChatMessage | null;
  /** A question here is waiting for another answer to finish. */
  waiting: boolean;
}

const anchorKey = (a: Anchor) => `${a.file}|${a.side}|${a.start}-${a.end}`;

/** Group a chat into threads, oldest first. Chats from before threads existed group by their lines. */
export function threadsOf(messages: ChatMessage[], pending: ChatMessage | null, queued: string[]): Thread[] {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const legacy = new Map<string, string>();
  const threadId = (m: ChatMessage): string => {
    if (m.thread) return m.thread;
    if (m.role === "assistant" && m.replyTo) {
      const q = byId.get(m.replyTo);
      return q ? threadId(q) : m.replyTo;
    }
    // Older questions about the same lines read as one thread.
    if (m.anchor) {
      const key = anchorKey(m.anchor);
      if (!legacy.has(key)) legacy.set(key, m.id);
      return legacy.get(key)!;
    }
    return m.id;
  };

  const out = new Map<string, Thread>();
  for (const m of messages) {
    const tid = threadId(m);
    let t = out.get(tid);
    if (!t) out.set(tid, (t = { id: tid, anchor: m.anchor, messages: [], pending: null, waiting: false }));
    t.messages.push(m);
  }
  const waiting = new Set(queued);
  for (const t of out.values()) {
    if (pending?.replyTo && t.messages.some((m) => m.id === pending.replyTo)) t.pending = pending;
    t.waiting = t.messages.some((m) => waiting.has(m.id));
  }
  return [...out.values()];
}

export const linesLabel = (a: Anchor) =>
  `${a.start === a.end ? `Line ${a.start}` : `Lines ${a.start}–${a.end}`}${a.side === "old" ? " (old)" : ""}`;
