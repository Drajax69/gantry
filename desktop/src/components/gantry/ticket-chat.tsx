"use client";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AgentPicker } from "@/components/agents/agent-picker";
import { ChatPanel } from "@/components/review/chat-panel";
import { threadsOf } from "@/lib/client/threads";
import { subscribeChat } from "@/lib/client/chat-events";
import { gantry } from "@/lib/client/gantry";
import type { ChatMessage } from "@/lib/types";

type Snapshot = { messages: ChatMessage[]; pending: ChatMessage | null; queued: string[]; checkouts: { repositoryId: string; path: string }[] };
export async function ticketChatRequest(ticketId: string, action: string, extra = {}) {
  const response = await fetch('/api/ticket-chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticketId, action, ...extra }) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Ticket chat is unavailable.');
  return body;
}
export function TicketChat({ ticketId, projectId, done }: { ticketId: string; projectId: string; done: boolean }) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const load = useCallback(async () => {
    try { setData(await ticketChatRequest(ticketId, 'load')); setError(null); }
    catch (e) { setError((e as Error).message); }
  }, [ticketId]);
  useEffect(() => {
    let live = true;
    const refresh = () => ticketChatRequest(ticketId, 'load').then(d => { if (live) { setData(d); setError(null); } }, e => { if (live) setError(e.message); });
    void refresh();
    const unsubscribe = subscribeChat(`ticket/${ticketId}`, e => {
      setData(d => {
        if (!d) return d;
        if (e.type === 'delta') return { ...d, pending: d.pending && { ...d.pending, text: d.pending.text + e.text } };
        if (e.type === 'tool') return { ...d, pending: d.pending && { ...d.pending, tools: [...(d.pending.tools || []), e.tool] } };
        return d;
      });
      if (!['delta', 'tool'].includes(e.type)) void refresh();
      if (e.type === 'done') void gantry.refreshProject(projectId).catch(() => {});
    });
    const timer = setInterval(refresh, 5000);
    return () => { live = false; unsubscribe(); clearInterval(timer); };
  }, [ticketId, projectId]);
  async function ask(text: string) {
    if (sending || done) return false;
    setSending(true);
    try { await ticketChatRequest(ticketId, 'send', { text }); await load(); return true; }
    catch (e) { toast.error((e as Error).message); return false; }
    finally { setSending(false); }
  }
  return <section className="flex h-full min-h-0 flex-col" aria-label="Ticket chat">
    <div className="flex flex-wrap items-center gap-3 border-b p-3"><AgentPicker align="start" /><span className="flex-1 text-xs text-muted-foreground">Same provider as reviews</span>
      <Button size="sm" variant="outline" disabled={done || sending || !!data?.pending} onClick={() => void ask('Implement the feature described in this ticket in its prepared worktrees. Read instructions, preserve unrelated changes, run relevant tests, and report the result. Do not commit, push or create PRs yet.')}>Implement feature</Button>
      <Button size="sm" variant="outline" disabled={done || sending || !!data?.pending || !data?.checkouts.length} onClick={() => void ask('Review the ticket changes and run relevant validation. If it passes, commit only ticket-related files, push this ticket branch without force, and create draft pull requests for changed repositories. Reuse existing PRs for this branch. Return every PR URL. Do not merge or deploy.')}>Create PR</Button>
    </div>
    {error && <div role="alert" className="p-3 text-sm text-destructive">{error}<Button variant="ghost" size="sm" onClick={() => void load()}>Retry</Button></div>}
    {sending && <p role="status" className="px-3 py-2 text-sm text-muted-foreground">Preparing ticket worktrees and sending your message…</p>}
    {done && <p className="p-3 text-sm text-muted-foreground">Reopen this ticket to continue the chat.</p>}
    <div className="min-h-0 flex-1"><ChatPanel ticket threads={threadsOf(data?.messages || [], data?.pending || null, data?.queued || [])} general={[]} onAsk={ask} onStop={() => void ticketChatRequest(ticketId, 'stop').then(load).catch(e => toast.error(e.message))} onDelete={messageId => void ticketChatRequest(ticketId, 'delete', { messageId }).then(load).catch(e => toast.error(e.message))} onOpenThread={() => {}} onOpenLocation={(file, line) => toast.info(`${file}:${line}`)} /></div>
  </section>;
}
