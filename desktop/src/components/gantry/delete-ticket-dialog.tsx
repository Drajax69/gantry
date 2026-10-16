"use client";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";

export function DeleteTicketDialog({ title, busy, onCancel, onDelete }: { title: string; busy: boolean; onCancel: () => void; onDelete: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => { dialog.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} aria-labelledby="delete-ticket-title" aria-describedby="delete-ticket-description" onCancel={e => { e.preventDefault(); if (!busy) onCancel(); }} className="fixed inset-0 m-auto max-h-[85dvh] w-[min(28rem,calc(100vw-32px))] overflow-auto rounded-xl border bg-background p-6 text-foreground shadow-xl backdrop:bg-black/40">
    <h2 id="delete-ticket-title" className="text-lg font-semibold">Delete ticket?</h2>
    <p className="mt-3 break-words text-sm font-medium">{title}</p>
    <p id="delete-ticket-description" className="mt-2 text-sm leading-relaxed text-muted-foreground">This removes the ticket from your board. Its worktrees and pull requests will remain.</p>
    <div className="mt-6 flex justify-end gap-2"><Button autoFocus variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button><Button variant="destructive" disabled={busy} onClick={onDelete}>{busy ? "Deleting…" : "Delete ticket"}</Button></div>
  </dialog>;
}
