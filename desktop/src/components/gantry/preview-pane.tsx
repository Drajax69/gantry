"use client";
import { useState } from "react";
import { TerminalIcon, ArrowUpRightIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { gantry, type PreviewView } from "@/lib/client/gantry";

import { PreviewDiagnostics, usePreviewDiagnostics } from "./preview-diagnostics";

function localUrl(value: string | null | undefined) {
  try { const url = new URL(value || ""); return ["http:", "https:"].includes(url.protocol) && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ? url.href : null; }
  catch { return null; }
}
export function PreviewPane({ name, preview, refresh }: { name: string; preview?: PreviewView; refresh: () => Promise<void> }) {
  const diagnostics = usePreviewDiagnostics();
  const [toolsOpen, setToolsOpen] = useState(false);
  const [serviceId, setServiceId] = useState("");
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [log, setLog] = useState("");
  const services = preview?.services ?? [];
  const service = services.find(s => s.id === serviceId) ?? services.find(s => /frontend|web|client/.test(s.id)) ?? services.find(s => s.openLink) ?? services[0];
  const url = localUrl(service?.openLink);
  async function action(action: string) {
    if (!preview) return;
    setBusy(true); setError("");
    try { await gantry.previewAction(preview.id, action); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not update preview."); }
    finally { setBusy(false); }
  }
  async function readLog(url: string) {
    try { const response = await fetch(`/api/gantry${url}`); if (!response.ok) throw new Error("Could not load logs."); setLog(await response.text() || "No output yet."); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load logs."); }
  }
  return <section aria-label={`${name} preview`} className="flex min-h-0 flex-1 flex-col">
    <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
      <label className="text-xs text-muted-foreground" htmlFor="preview-service">Service</label>
      <select id="preview-service" className="h-8 max-w-48 rounded-lg border bg-background px-2 text-sm" value={service?.id ?? ""} onChange={e => { setServiceId(e.target.value); setLog(""); }}>{services.map(s => <option key={s.id} value={s.id}>{s.id} · {s.state}</option>)}</select>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{url ?? preview?.status ?? "Preparing preview"}</span>
      <Button size="sm" variant="ghost" disabled={!url} onClick={() => setReload(n => n + 1)}><RefreshCwIcon />Reload</Button>
      <Button size="sm" variant={toolsOpen ? "secondary" : "ghost"} aria-expanded={toolsOpen} onClick={() => setToolsOpen(value => !value)}><TerminalIcon />Console & Network</Button>
      {url && <a href={url} target="_blank" rel="noreferrer" aria-label={`Open ${name} in browser`} className="inline-flex items-center gap-1 text-xs underline underline-offset-4">Open in browser<ArrowUpRightIcon className="size-3" /></a>}
    </div>
    {error && <p role="alert" className="px-4 py-2 text-sm text-destructive">{error}</p>}
    <div className="relative flex min-h-0 flex-1 overflow-hidden">
    {url && service?.state === "ready" ? <iframe ref={diagnostics.frame} onLoad={diagnostics.connect} key={`${url}:${reload}`} title={`${name} preview`} src={url} sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox" className="min-h-80 min-w-0 w-full flex-1 border-0 bg-white" /> : <div className="flex min-h-64 flex-1 flex-col items-center justify-center gap-3 p-8 text-center"><p className="font-medium">{preview?.paused ? "Preview paused" : service?.error ? "Preview needs attention" : "Preparing your preview"}</p><p className="max-w-lg text-sm text-muted-foreground">{service?.error ?? (preview ? "The page will appear here when its service is ready." : "Create this ticket’s worktrees to start its preview.")}</p>{preview?.paused && <Button disabled={busy} onClick={() => void action("resume")}>Resume preview</Button>}</div>}
    {toolsOpen && <PreviewDiagnostics entries={diagnostics.entries} connected={diagnostics.connected} clear={diagnostics.clear} close={() => setToolsOpen(false)} />}
    </div>
    <details className="shrink-0 border-t px-4 py-3 text-xs"><summary className="cursor-pointer font-medium">Services and logs · {preview?.status ?? "Waiting"}</summary><div className="max-h-64 space-y-3 overflow-auto pt-3">
      <div className="flex gap-2">{preview && <Button size="sm" variant="outline" disabled={busy} onClick={() => void action("restart")}>Restart services</Button>}{preview && !preview.isPrimary && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void action(preview.paused ? "resume" : "pause")}>{preview.paused ? "Resume" : "Pause"}</Button>}</div>
      {services.map(s => <div key={s.id} className="flex flex-wrap items-center gap-3"><span className="font-medium">{s.id}</span><span>{s.state}</span>{s.error && <span className="text-destructive">{s.error}</span>}{s.logUrl && <Button size="xs" variant="ghost" onClick={() => void readLog(s.logUrl!)}>Logs for {s.id}</Button>}</div>)}
      {log && <pre className="overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3">{log}</pre>}
    </div></details>
  </section>;
}
