import type { ChatEvent, TargetChatEvent } from "@/lib/types";

type Handler = (e: ChatEvent) => void;

/**
 * One EventSource for the whole page, fanned out by target. Several tabs each holding their
 * own stream would hit the browser's per-host connection cap and stall other requests.
 */
const handlers = new Map<string, Set<Handler>>();
let source: EventSource | null = null;

function open() {
  source = new EventSource("/api/chat/events");
  source.onmessage = (ev) => {
    const e = JSON.parse(ev.data) as TargetChatEvent;
    for (const h of handlers.get(e.target) ?? []) h(e);
  };
}

export function subscribeChat(target: string, handler: Handler): () => void {
  let set = handlers.get(target);
  if (!set) handlers.set(target, (set = new Set()));
  set.add(handler);
  if (!source) open();
  return () => {
    set.delete(handler);
    if (!set.size) handlers.delete(target);
    if (!handlers.size && source) {
      source.close();
      source = null;
    }
  };
}
