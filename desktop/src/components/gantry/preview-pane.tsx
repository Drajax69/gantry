"use client";
import { useEffect, useState, useId } from "react";
import { BugIcon, ArrowUpRightIcon, MessageSquareIcon, GitPullRequestIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { gantry, type PreviewView } from "@/lib/client/gantry";

import { PreviewDiagnostics, usePreviewDiagnostics } from "./preview-diagnostics";

function localUrl(value: string | null | undefined) {
  try { const url = new URL(value || ""); return ["http:", "https:"].includes(url.protocol) && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ? url.href : null; }
  catch { return null; }
}
export function PreviewPane({ name, preview, refresh, onOpenChat, openingChat, onReview, reviewDisabled, active }: { name: string; preview?: PreviewView; refresh: () => Promise<void>; onOpenChat?: () => void; openingChat?: boolean; onReview?: () => void; reviewDisabled?: boolean; active: boolean }) {
  const diagnostics = usePreviewDiagnostics();
  const serviceSelectId = useId();
  const logSelectId = useId();
  const [visited, setVisited] = useState(active);
  const [reload, setReload] = useState(0);
  useEffect(() => { if (active) setVisited(true); }, [active]);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [serviceId, setServiceId] = useState("");
  const [logServiceId, setLogServiceId] = useState("");
  const [logRefresh, setLogRefresh] = useState(0);
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
  const logService = services.find(s => s.id === logServiceId) ?? services[0];
  useEffect(() => {
    const controller = new AbortController();
    setLog("");
    if (!toolsOpen || !logService?.logUrl) return;
    setLog("Loading logs…");
    fetch(`/api/gantry${logService.logUrl}`, {signal: controller.signal})
      .then(async response => { if (!response.ok) throw new Error("Could not load logs."); return response.text(); })
      .then(text => setLog(text || "No output yet."))
      .catch(error => { if (!controller.signal.aborted) setLog(error.message); });
    return () => controller.abort();
  }, [toolsOpen, logService?.logUrl, logRefresh]);
  const serviceLogs = <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex flex-wrap items-center gap-2 border-b p-2">
      <label htmlFor={logSelectId} className="text-xs">Service</label>
      <select id={logSelectId} className="h-8 min-w-0 flex-1 rounded-lg border bg-background px-2 text-xs" value={logService?.id ?? ""} onChange={e => setLogServiceId(e.target.value)}>{services.map(s => <option key={s.id} value={s.id}>{s.id} · {s.state}</option>)}</select>
      <Button size="sm" variant="ghost" onClick={() => setLogRefresh(n => n + 1)}>Refresh logs</Button>
    </div>
    {logService?.error && <p className="p-2 text-xs text-destructive">{logService.error}</p>}
    <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all p-3 text-xs">{logService?.logUrl ? log : "No logs available for this service."}</pre>
    <div className="flex gap-2 border-t p-2">{preview && <Button size="sm" variant="outline" disabled={busy} onClick={() => void action("restart")}>Restart services</Button>}{preview && !preview.isPrimary && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void action(preview.paused ? "resume" : "pause")}>{preview.paused ? "Resume" : "Pause"}</Button>}</div>
  </div>;
  if (!active && !visited) return null;
  return <section aria-label={`${name} preview`} className="flex min-h-0 flex-1 flex-col">
    <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
      <label className="text-xs text-muted-foreground" htmlFor={serviceSelectId}>Service</label>
      <select id={serviceSelectId} className="h-8 max-w-48 rounded-lg border bg-background px-2 text-sm" value={service?.id ?? ""} onChange={e => { setServiceId(e.target.value); setLog(""); }}>{services.map(s => <option key={s.id} value={s.id}>{s.id} · {s.state}</option>)}</select>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{url ?? preview?.status ?? "Preparing preview"}</span>
      {onOpenChat && <Button size="sm" variant="ghost" disabled={openingChat} onClick={onOpenChat}><MessageSquareIcon />{openingChat ? "Opening…" : "Open chat"}</Button>}
      {onReview && <Button size="sm" variant="ghost" disabled={reviewDisabled} onClick={onReview}><GitPullRequestIcon />Review</Button>}
      <Button size="sm" variant="ghost" disabled={!url} onClick={() => setReload(value => value + 1)}><RefreshCwIcon />Reload</Button>
      <Button size="sm" variant={toolsOpen ? "secondary" : "ghost"} aria-expanded={toolsOpen} onClick={() => setToolsOpen(value => !value)}><BugIcon />Debug</Button>
      {url && <a href={url} target="_blank" rel="noreferrer" aria-label={`Open ${name} in browser`} className="inline-flex items-center gap-1 text-xs underline underline-offset-4">Open in browser<ArrowUpRightIcon className="size-3" /></a>}
    </div>
    {error && <p role="alert" className="px-4 py-2 text-sm text-destructive">{error}</p>}
    <div className="relative flex min-h-0 flex-1 overflow-hidden">
    {url && service?.state === "ready" ? <iframe ref={diagnostics.frame} onLoad={diagnostics.connect} key={`${url}:${reload}`} title={`${name} preview`} src={url} sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox" className="min-h-80 min-w-0 w-full flex-1 border-0 bg-white" /> : <div className="flex min-h-64 flex-1 flex-col items-center justify-center gap-3 p-8 text-center"><p className="font-medium">{preview?.paused ? "Preview paused" : service?.error ? "Preview needs attention" : "Preparing your preview"}</p><p className="max-w-lg text-sm text-muted-foreground">{service?.error ?? (preview ? "The page will appear here when its service is ready." : "Create this ticket’s worktrees to start its preview.")}</p>{preview?.paused && <Button disabled={busy} onClick={() => void action("resume")}>Resume preview</Button>}</div>}
    {toolsOpen && <PreviewDiagnostics serviceLogs={serviceLogs} entries={diagnostics.entries} connected={diagnostics.connected} clear={diagnostics.clear} close={() => setToolsOpen(false)} />}
    </div>
  </section>;
}
