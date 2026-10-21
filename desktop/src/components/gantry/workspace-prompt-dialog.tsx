"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { gantry, type ProjectView } from "@/lib/client/gantry";
import { useUnsavedGraph } from "@/lib/client/unsaved-graph";

export function WorkspacePromptDialog({ project, onClose }: { project: ProjectView; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [prompt, setPrompt] = useState("");
  const [saved, setSaved] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const edits = useUnsavedGraph(loaded && prompt !== saved);
  const close = () => { if (!busy && edits.confirmDiscard()) onClose(); };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    let live = true;
    dialog.showModal();
    gantry.workspacePrompt(project.id).then(result => { if (live) { setPrompt(result.prompt); setSaved(result.prompt); setLoaded(true); } }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; dialog.close(); previous?.focus(); };
  }, [project.id]);
  async function save() {
    setBusy(true); setError("");
    try { await gantry.saveWorkspacePrompt(project.id, prompt); edits.markSaved(); setSaved(prompt); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save prompt."); }
    finally { setBusy(false); }
  }
  return <dialog ref={ref} aria-labelledby="workspace-prompt-title" onCancel={e => { e.preventDefault(); e.stopPropagation(); close(); }} className="fixed inset-0 m-auto max-h-[90dvh] w-[min(52rem,calc(100vw-32px))] overflow-auto rounded-xl border bg-background p-6 text-foreground shadow-xl backdrop:bg-black/40">
    <h2 id="workspace-prompt-title" className="text-lg font-semibold">Shared instructions · {project.name}</h2>
    <p className="mt-2 text-sm text-muted-foreground">Tell every stage how to work in your project. Add context, coding conventions, test commands, and what a finished result should look like. Keep step-specific tasks in each node.</p>
    <p className="mt-3 rounded-md border bg-muted/40 p-3 text-sm">For example: “Follow AGENTS.md. Use the existing components. Run npm test and npm run typecheck. Include a short summary of changes and checks.”</p>
    <label htmlFor="workspace-starting-prompt" className="mt-5 mb-2 block text-sm font-medium">Starting prompt</label><Textarea id="workspace-starting-prompt" autoFocus value={prompt} onChange={e => setPrompt(e.target.value)} disabled={!loaded || busy} maxLength={100000} className="h-[45dvh] min-h-48 resize-y font-mono text-xs leading-relaxed" />
    <p className="mt-2 text-xs text-muted-foreground">Use {"${ticket.title}"}, {"${ticket.description}"}, {"${ticket.branch}"}, {"${workspace}"}, {"${previewUrl}"}, or {"${repo.<repository-id>}"}. Ticket details and prepared worktree paths are also included automatically.</p>
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    <p className="mt-2 text-xs text-muted-foreground">Saved in this workspace’s gantry.yaml. New stages and ticket conversations use these instructions; existing conversations retain their original context.</p>
    <div className="mt-5 flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={close}>Cancel</Button><Button disabled={!loaded || busy || !prompt.trim()} onClick={() => void save()}>{busy ? "Saving…" : "Save prompt"}</Button></div>
  </dialog>;
}
