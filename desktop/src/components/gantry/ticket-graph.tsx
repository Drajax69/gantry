"use client";

import { useState, type ReactNode } from "react";
import type { TicketView } from "@/lib/client/gantry";
import { Input } from "@/components/ui/input";
import { Graph, currentWorkflowStage } from "./workflow";

function TicketWorkflowGraph({ ticket, card }: { ticket: TicketView; card: ReactNode }) {
  const [selection, setSelection] = useState("");
  const run = ticket.workflow;
  const current = currentWorkflowStage(run, ticket.execution);
  const selected = run?.graph.nodes.some(node => node.id === selection) ? selection : current;
  const currentNode = run?.graph.nodes.find(node => node.id === current);

  return <section aria-label={`Workflow for ${ticket.title}`} className="min-w-0 space-y-3 rounded-xl border bg-background p-4 shadow-sm">
    {card}
    {run?.graph.nodes.length ? <>
      <p className="text-sm" role="status">
        <span className="text-muted-foreground">{ticket.execution?.state === "complete" || run.graph.nodes.every(node => run.states[node.id]?.state === "done") ? "Workflow complete · " : "Current stage · "}</span>
        <span className="font-medium">{currentNode?.label}</span>
      </p>
      <Graph graph={run.graph} run={run} selected={selected} current={current} onSelect={setSelection} compact />
    </> : <p className="py-6 text-sm text-muted-foreground">{run ? "No workflow stages yet." : "No workflow snapshot. Open the ticket to copy the workspace graph."}</p>}
  </section>;
}

/** Each in-progress ticket keeps its own complete workflow and live stage state. */
export function TicketGraph({ tickets, cards, connected }: {
  tickets: TicketView[];
  cards: Map<string, ReactNode>;
  connected: boolean;
}) {
  const [query, setQuery] = useState("");
  const active = tickets.filter(ticket => ticket.status === "in_progress");
  const visible = active.filter(ticket =>
    (ticket.title + " " + ticket.branch).toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));

  return <section aria-label="Ticket graph" className="flex min-h-full flex-col">
    <div className="flex flex-wrap items-center gap-3 border-b px-6 py-3">
      <Input aria-label="Search ticket graph" placeholder="Find a ticket or branch…" className="max-w-xs" value={query} onChange={e => setQuery(e.target.value)} />
      <span className="text-xs text-muted-foreground">{visible.length} in-progress tickets</span>
      <span className="ml-auto text-xs text-muted-foreground" role="status">{connected ? "Updates every 2 seconds" : "Connection interrupted · showing saved state"}</span>
    </div>
    <div className="flex-1 overflow-auto p-6" style={{ backgroundImage: "radial-gradient(var(--border) 1px, transparent 1px)", backgroundSize: "20px 20px" }}>
      <p className="mb-6 text-xs text-muted-foreground">Full workflows for in-progress tickets, with their current stages. Select a stage to inspect the graph or open the ticket for details and actions.</p>
      <div className="grid min-w-0 grid-cols-1 gap-6 pb-6 2xl:grid-cols-2">
        {visible.map(ticket => <TicketWorkflowGraph key={ticket.id} ticket={ticket} card={cards.get(ticket.id)} />)}
      </div>
      {!visible.length && <p className="py-6 text-sm text-muted-foreground">{active.length ? "No matching in-progress tickets." : "No in-progress tickets. Move a ticket to In progress to see its workflow here."}</p>}
    </div>
  </section>;
}
