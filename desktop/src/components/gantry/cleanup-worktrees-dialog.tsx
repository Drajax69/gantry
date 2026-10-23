"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { gantry, type CleanupAssessment, type CleanupResult } from "@/lib/client/gantry";

export function CleanupWorktreesDialog({ ticketId, title, onClose, onCleaned }: {
  ticketId: string;
  title: string;
  onClose: () => void;
  onCleaned: () => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [assessment, setAssessment] = useState<CleanupAssessment | null>(null);
  const [results, setResults] = useState<CleanupResult['results']>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    let active = true;
    dialog.showModal();
    gantry.assessCleanup(ticketId).then(value => { if (active) setAssessment(value); })
      .catch(e => { if (active) setError((e as Error).message); });
    return () => { active = false; dialog.close(); previous?.focus(); };
  }, [ticketId]);

  const eligible = assessment?.checkouts.filter(c => c.eligible) ?? [];

  async function remove() {
    if (busy || !eligible.length || assessment?.blockers.length) return;
    setBusy(true);
    setError(null);
    try {
      const result = await gantry.cleanupWorktrees(ticketId, eligible);
      setResults(result.results);
      setAssessment(result.assessment);
      await onCleaned();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} aria-labelledby="cleanup-worktrees-title" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }} className="fixed inset-0 m-auto max-h-[85dvh] w-[min(40rem,calc(100vw-32px))] overflow-auto rounded-xl border bg-background p-6 text-foreground shadow-xl backdrop:bg-black/40">
      <h2 id="cleanup-worktrees-title" className="text-lg font-semibold">Clean merged worktrees</h2>
      <p className="mt-3 break-words text-sm font-medium">{title}</p>
      <p className="mt-2 text-sm text-muted-foreground">Remove the eligible checkout folders below, including ignored build files and dependencies. The ticket, branches, pull requests and conversation history are kept. Close interactive agents before confirming. Git checks are repeated before removal.</p>
      {!assessment && !error && <p className="mt-4" role="status">Checking worktrees…</p>}
      {error && <p className="mt-4 text-sm text-destructive" role="alert">{error}</p>}
      {assessment?.blockers.map(reason => <p key={reason} className="mt-3 text-sm text-destructive">{reason}</p>)}
      {assessment && !assessment.checkouts.length && <p className="mt-4 text-sm">No ticket worktrees remain.</p>}
      <ul className="mt-4 space-y-3">
        {assessment?.checkouts.map(c => <li key={`${c.repositoryId}:${c.path}`} className="rounded-lg border p-3 text-sm">
          <strong>{c.repositoryId}</strong>
          <p className="break-all font-mono text-xs">{c.path}</p>
          <p className="mt-1">{c.eligible ? 'Ready to remove' : 'Kept'} · {c.reason}</p>
        </li>)}
      </ul>
      <ul className="mt-4 space-y-2" aria-live="polite">
        {results.map((r, index) => <li key={index} className="break-words text-sm">{r.repositoryId}: {r.status} · {r.reason}</li>)}
      </ul>
      <div className="mt-6 flex justify-end gap-2">
        <Button autoFocus variant="outline" disabled={busy} onClick={onClose}>Close</Button>
        <Button variant="destructive" disabled={busy || !eligible.length || !!assessment?.blockers.length} onClick={() => void remove()}>
          {busy ? 'Removing…' : `Remove ${eligible.length} worktree${eligible.length === 1 ? '' : 's'}`}
        </Button>
      </div>
    </dialog>
  );
}
