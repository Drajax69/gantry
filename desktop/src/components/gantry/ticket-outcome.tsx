"use client";

import { useState } from "react";
import { FlagIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { gantry, type TicketView } from "@/lib/client/gantry";

const URL_PATTERN = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

/** Plain text with its links made clickable. */
function Linked({ text }: { text: string }) {
  return <>{text.split(URL_PATTERN).map((part, i) => i % 2
    ? <a key={i} href={part} target="_blank" rel="noreferrer" className="break-all text-foreground underline underline-offset-4">{part}</a>
    : part)}</>;
}

/**
 * Final notes: the ticket's result, which may be a link (a shared doc, a spreadsheet) rather than code.
 * The person edits it here; a stage sets it with "finalNotes" in its GANTRY_RESULT handover.
 */
export function TicketOutcome({ ticket, busy, act }: { ticket: TicketView; busy: boolean; act: (action: () => Promise<unknown>, message?: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const outcome = ticket.outcome?.trim() ?? "";
  const save = async () => { if (await act(() => gantry.setTicketOutcome(ticket.id, draft), "Final notes saved")) setEditing(false); };
  return <section aria-label="Final notes" className="space-y-2 rounded-lg border bg-muted/30 p-4">
    <div className="flex items-center gap-2"><FlagIcon aria-hidden="true" className="size-4 text-muted-foreground" /><h3 className="flex-1 text-sm font-medium">Final notes</h3>
      {!editing && <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setDraft(outcome); setEditing(true); }}>{outcome ? "Edit" : "Add"}</Button>}</div>
    {editing
      ? <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <Textarea autoFocus aria-label="Final notes" className="min-h-24" value={draft} maxLength={5000} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void save(); } }} placeholder="The result of this ticket: a link, a decision, or a short summary" />
          <div className="flex gap-2"><Button type="submit" size="sm" disabled={busy}>{busy && <Loader2Icon className="animate-spin" />}Save</Button><Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button></div>
        </form>
      : outcome
        ? <p className="whitespace-pre-wrap break-words text-sm leading-relaxed"><Linked text={outcome} /></p>
        : <p className="text-sm text-muted-foreground">No final notes yet. Add the outcome here, such as a link to the doc this ticket produced.</p>}
  </section>;
}
