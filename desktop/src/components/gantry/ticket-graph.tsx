"use client";

import { useState, type ReactNode } from "react";
import type { TicketView } from "@/lib/client/gantry";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const stages = [
  { id: "backlog", label: "Backlog", color: "text-violet-600 dark:text-violet-300" },
  { id: "in_progress", label: "In progress", color: "text-sky-600 dark:text-sky-300" },
  { id: "done", label: "Done", color: "text-emerald-600 dark:text-emerald-300" },
];

/** Connectors express status membership, never dependencies between tickets. */
export function TicketGraph({ tickets, cards, connected }: {
  tickets: TicketView[];
  cards: Map<string, ReactNode>;
  connected: boolean;
}) {
  const [query, setQuery] = useState("");
  const [activeOnly, setActiveOnly] = useState(false);
  const visible = tickets.filter(t => (!activeOnly || t.status === "in_progress") &&
    (t.title + " " + t.branch).toLowerCase().includes(query.trim().toLowerCase()));
  return <section aria-label="Ticket graph" className="flex min-h-full flex-col">
    <div className="flex flex-wrap items-center gap-3 border-b px-6 py-3">
      <Input aria-label="Search ticket graph" placeholder="Find a ticket or branch…" className="max-w-xs" value={query} onChange={e => setQuery(e.target.value)} />
      <Button size="sm" variant={activeOnly ? "secondary" : "ghost"} aria-pressed={activeOnly} onClick={() => setActiveOnly(!activeOnly)}>In progress only</Button>
      <span className="ml-auto text-xs text-muted-foreground" role="status">{connected ? "Updates every 2 seconds" : "Connection interrupted · showing saved state"}</span>
    </div>
    <div className="flex-1 overflow-auto p-6" style={{ backgroundImage: "radial-gradient(var(--border) 1px, transparent 1px)", backgroundSize: "20px 20px" }}>
      <p className="mb-6 text-xs text-muted-foreground">Tickets connect to their current stage. Open a node for workflow progress and ticket actions.</p>
      <div className="grid min-w-[960px] grid-cols-3 gap-10 pb-6">
        {stages.map(stage => {
          const nodes = visible.filter(t => t.status === stage.id).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
          return <section key={stage.id} aria-label={stage.label + " nodes"}>
            <h2 className={"relative z-10 flex items-center gap-3 rounded-full border bg-background px-5 py-3 text-sm font-semibold shadow-sm " + stage.color}>
              <span aria-hidden="true" className="size-2 rounded-full bg-current" />
              {stage.label}<span className="ml-auto tabular-nums">{nodes.length}</span>
            </h2>
            <div className="ml-6 border-l-2 border-border py-4">
              {nodes.map(ticket => <div key={ticket.id} className="relative py-3 pl-6 before:absolute before:left-0 before:top-10 before:w-6 before:border-t-2 before:border-border">
                {cards.get(ticket.id)}
              </div>)}
              {!nodes.length && <p className="p-6 text-xs text-muted-foreground">No matching tickets.</p>}
            </div>
          </section>;
        })}
      </div>
    </div>
  </section>;
}
