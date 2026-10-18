"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client/api";
import type { Anchor } from "@/lib/types";
import { InlineComposer } from "./thread";

export function FileEditor({ id, path, agentName, onClose, onSaved, onAsk }: {
  id: string; path: string; agentName: string; onClose: () => void; onSaved: () => void;
  onAsk: (text: string, anchor: Anchor) => Promise<boolean>;
}) {
  const [base, setBase] = useState<{ text: string; revision: string } | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [selection, setSelection] = useState<Anchor | null>(null);
  const [asking, setAsking] = useState<Anchor | null>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const dirty = base !== null && text !== base.text;
  useEffect(() => {
    let live = true;
    api.editFile(id, path).then(value => {
      if (live) { setBase(value); setText(value.text); }
    }, (e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [id, path]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  async function save() {
    if (!base || saving) return;
    setSaving(true); setError(null);
    try {
      // Textareas normalize line endings; retain the original file's convention.
      const content = base.text.includes("\r\n") ? text.replace(/\r?\n/g, "\r\n") : text;
      const value = await api.saveFile(id, path, content, base.revision);
      setBase(value); setText(value.text); setSaved(true); onSaved();
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }
  function select() {
    const el = editor.current;
    if (!el || el.selectionStart === el.selectionEnd) return setSelection(null);
    const value = el.value;
    const start = value.slice(0, el.selectionStart).split("\n").length;
    const end = value.slice(0, el.selectionEnd - (value[el.selectionEnd - 1] === "\n" ? 1 : 0)).split("\n").length;
    setSelection({ file: path, side: "new", start, end, snippet: value.split("\n").slice(start - 1, Math.min(end, start + 79)).join("\n") });
  }
  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
      <span className="min-w-0 flex-1 truncate font-mono text-xs" title={path}>{path}</span>
      <span className="text-xs text-muted-foreground" role="status">{saving ? "Saving…" : dirty ? "Unsaved changes" : saved ? "Saved locally" : "Local file"}</span>
      <Button size="xs" disabled={!dirty || saving} onClick={() => void save()}>Save</Button>
      <Button size="xs" variant="ghost" disabled={saving} onClick={() => { if (!dirty || window.confirm("Discard unsaved changes to this file?")) onClose(); }}>Close editor</Button>
    </div>
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
      <span>Type to edit. Select code to ask {agentName}.</span>
      <Button size="xs" variant="outline" disabled={!selection || saving} onMouseDown={e => e.preventDefault()} onClick={() => setAsking(selection)}>Ask about selection</Button>
    </div>
    {error && <p role="alert" className="px-3 py-2 text-sm text-destructive">{error}</p>}
    {!base && !error && <p role="status" className="p-3 text-sm">Loading local file…</p>}
    {base && <textarea ref={editor} aria-label={`Edit ${path}`} spellCheck={false} wrap="off" value={text} readOnly={saving}
      className="min-h-0 flex-1 resize-none bg-background p-3 font-mono text-xs leading-5 text-foreground selection:bg-amber-300/35 focus-visible:outline-2 focus-visible:outline-ring"
      onChange={e => { setText(e.target.value); setSaved(false); setAsking(null); }} onSelect={select}
      onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); void save(); } }} />}
    {asking && <div className="max-h-[45%] overflow-auto border-t p-3">
      {dirty && <p className="mb-2 text-xs text-muted-foreground">Save your changes before asking the agent to edit this code.</p>}
      <InlineComposer anchor={asking} agent={agentName} onCancel={() => setAsking(null)} onSubmit={async question => {
        if (dirty) { setError("Save your changes before asking the agent."); return false; }
        const ok = await onAsk(question, asking);
        if (ok) { setAsking(null); onClose(); }
        return ok;
      }} />
    </div>}
  </div>;
}
