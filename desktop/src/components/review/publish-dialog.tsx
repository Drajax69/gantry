"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client/api";
import type { LocalChanges } from "@/lib/types";
export function PublishDialog({ id, snapshot, onClose, onPublished }: { id: string; snapshot: LocalChanges; onClose: () => void; onPublished: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} onCancel={e => { if (busy) e.preventDefault(); else onClose(); }} className="fixed inset-0 m-auto max-h-[85vh] w-[min(36rem,calc(100vw-3rem))] overflow-y-auto rounded-xl border bg-background p-6 text-foreground shadow-xl backdrop:bg-black/40" aria-labelledby="publish-title">
    <h2 id="publish-title" className="text-lg font-semibold">Commit and push</h2>
    <p className="mt-2 text-sm text-muted-foreground">Publish all local changes to <strong className="break-all text-foreground">{snapshot.branch}</strong> and update this PR.</p>
    <ul className="my-4 max-h-52 overflow-auto rounded-md border p-3 text-sm" aria-label="Files to publish">{snapshot.files.map(f => <li key={f.path} className="flex gap-3 py-1"><span className="w-4 shrink-0 font-mono">{f.status}</span><span className="break-all">{f.path}</span></li>)}</ul>
    {snapshot.commits > 0 && <p className="mb-3 text-sm text-muted-foreground">Includes {snapshot.commits} local commit{snapshot.commits === 1 ? "" : "s"} waiting to be pushed.</p>}
    <label className="block text-sm font-medium" htmlFor="commit-message">Commit message</label>
    <input id="commit-message" autoFocus value={message} onChange={e => setMessage(e.target.value)} disabled={busy} placeholder="Describe the change" className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm" />
    <p className="mt-2 text-xs text-muted-foreground">If the changes are already committed, this only pushes them.</p>
    {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
    <div className="mt-6 flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={busy || (!message.trim() && snapshot.commits === 0)} onClick={async () => {
      setBusy(true); setError(null);
      try { await api.publish(id, snapshot, message); onPublished(); }
      catch (e) { setError((e as Error).message); }
      finally { setBusy(false); }
    }}>{busy ? "Publishing…" : "Commit and push"}</Button></div>
  </dialog>;
}
