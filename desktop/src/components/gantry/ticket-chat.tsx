"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowUpRightIcon, MessageSquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AgentPicker } from "@/components/agents/agent-picker";
import { useAgents } from "@/lib/client/agents";

type Conversation = { provider: "claude" | "codex" | "opencode"; providerName: string; sessionId: string };
export async function ticketChatRequest(ticketId: string, action: string) {
  const response = await fetch('/api/ticket-chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticketId, action }) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Could not open the ticket conversation.');
  return body;
}
export async function openTicketChat(ticketId: string) {
  const result = await ticketChatRequest(ticketId, 'open');
  const conversation = result.conversation as Conversation;
  toast.success(`Opened this ticket's ${conversation.providerName} chat in herdr`);
  return conversation;
}

export function TicketConversation({ ticketId, done }: { ticketId: string; done: boolean }) {
  const agents = useAgents();
  const current = agents?.agents.find(a => a.id === agents.current);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    ticketChatRequest(ticketId, 'load').then(data => { if (live) setConversation(data.conversation); }, e => { if (live) setError(e.message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [ticketId]);
  const unsupported = !conversation && current?.kind === 'openai';
  return <section className="space-y-3" aria-label="Ticket conversation">
    <h3 className="text-sm font-medium">Conversation</h3>
    {conversation ? <p className="text-sm text-muted-foreground">Linked to {conversation.providerName}. Open chat reopens this ticket’s saved conversation in herdr.</p> : <>
      <div className="flex items-center gap-3"><AgentPicker align="start" /><span className="text-xs text-muted-foreground">Default for new conversations</span></div>
      <p className="text-sm text-muted-foreground">Open chat prepares this ticket’s worktrees and opens its conversation in herdr. Continue the feature and create its PR there; linked PRs appear in Review.</p>
    </>}
    {!conversation && current?.kind === 'codex' && <p className="text-xs text-muted-foreground">New Codex chats start with Full Access, including filesystem and network access without approval prompts.</p>}
    {unsupported && <p className="text-sm text-muted-foreground">API providers have no external conversation launcher. Select Claude Code, OpenCode or Codex to work on this ticket.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button disabled={loading || opening || unsupported || (done && !conversation)} onClick={async () => {
      setOpening(true); setError(null);
      try { setConversation(await openTicketChat(ticketId)); }
      catch (e) { setError((e as Error).message); }
      finally { setOpening(false); }
    }}><MessageSquareIcon />{opening ? 'Opening…' : 'Open chat'}<ArrowUpRightIcon /></Button>
    {done && !conversation && <p className="text-xs text-muted-foreground">Reopen the ticket to create its conversation.</p>}
  </section>;
}
