"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client/api";

export function MergeDialog({ id, head, title, onClose, onMerged }: {
  id: string; head: string; title: string; onClose: () => void; onMerged: (warning: string | null) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [method, setMethod] = useState("squash");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} onCancel={e => { if (busy) e.preventDefault(); else onClose(); }} className="fixed inset-0 m-auto w-[min(36rem,calc(100vw-3rem))] rounded-xl border bg-background p-6 text-foreground shadow-xl backdrop:bg-black/40" aria-labelledby="merge-title">
    <h2 id="merge-title" className="text-lg font-semibold">Merge PR</h2>
    <p className="mt-2 break-words text-sm">{title}</p>
    <p className="mt-2 text-sm text-muted-foreground">Merge the reviewed changes into the PR’s base branch on GitHub. Gantry moves the linked ticket to Done after all its repository changes are confirmed merged.</p>
    <label htmlFor="merge-method" className="mt-4 block text-sm font-medium">Merge method</label>
    <select id="merge-method" autoFocus disabled={busy} value={method} onChange={e => setMethod(e.target.value)} className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm">
      <option value="squash">Squash and merge</option><option value="merge">Create a merge commit</option><option value="rebase">Rebase and merge</option>
    </select>
    {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
    <div className="mt-6 flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={async () => {
      setBusy(true); setError(null);
      try { const result = await api.merge(id, head, method); onMerged(result.warning); }
      catch (e) { setError((e as Error).message); }
      finally { setBusy(false); }
    }}>{busy ? "Merging…" : "Confirm merge"}</Button></div>
  </dialog>;
}
