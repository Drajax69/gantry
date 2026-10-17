"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { XIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type DiagnosticEntry = { id: number; time: number; kind: "console" | "network"; level?: string; message?: string; method?: string; url?: string; status?: number | null; duration?: number; requestType?: string; error?: string; requestHeaders?: string; requestBody?: string; responseHeaders?: string; responseBody?: string };
function valid(entry: unknown): entry is DiagnosticEntry {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as DiagnosticEntry;
  return typeof e.id === "number" && typeof e.time === "number" && (e.kind === "console" ? typeof e.message === "string" : e.kind === "network" && typeof e.url === "string" && typeof e.method === "string");
}
export function usePreviewDiagnostics() {
  const frame = useRef<HTMLIFrameElement>(null);
  const channel = useRef<MessagePort | null>(null);
  const [entries, setEntries] = useState<DiagnosticEntry[]>([]);
  const [connected, setConnected] = useState(false);
  useEffect(() => () => channel.current?.close(), []);
  function connect() {
    channel.current?.close(); setConnected(false); setEntries([]);
    const element = frame.current;
    if (!element?.contentWindow) return;
    const next = new MessageChannel(); channel.current = next.port1;
    next.port1.onmessage = event => {
      if (channel.current !== next.port1) return;
      if (event.data?.type === "snapshot" && Array.isArray(event.data.entries)) {
        setConnected(true); setEntries(event.data.entries.filter(valid).slice(-500));
      } else if (event.data?.type === "update" && valid(event.data.entry)) {
        setEntries(old => old.map(entry => entry.id === event.data.entry.id ? event.data.entry : entry));
      } else if (event.data?.type === "entry" && valid(event.data.entry)) {
        setEntries(old => [...old, event.data.entry].slice(-500));
      }
    };
    element.contentWindow.postMessage({type:"gantry-diagnostics-connect"}, new URL(element.src).origin, [next.port2]);
  }
  return {frame, entries, connected, connect, clear: () => setEntries([])};
}
export function PreviewDiagnostics({ entries, connected, clear, close, serviceLogs }: { serviceLogs: ReactNode; entries: DiagnosticEntry[]; connected: boolean; clear: () => void; close: () => void }) {
  const [tab, setTab] = useState<"console" | "network" | "logs">("console");
  const [filter, setFilter] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [xhrOnly, setXhrOnly] = useState(false);
  const rows = entries.filter(e => e.kind === tab && (tab !== "network" || !xhrOnly || e.requestType === "xhr") && (!errorsOnly || e.level === "error" || (e.status !== undefined && e.status !== null && (e.status === 0 || e.status >= 400))) && `${e.message ?? ""} ${e.method ?? ""} ${e.url ?? ""} ${e.status ?? ""}`.toLowerCase().includes(filter.toLowerCase()));
  return <aside aria-label="Preview developer tools" className="absolute inset-y-0 right-0 z-10 flex w-[min(30rem,100%)] flex-col border-l bg-background shadow-xl xl:static xl:w-[28rem] xl:shrink-0 xl:shadow-none">
    <header className="flex items-center gap-2 border-b px-3 py-2"><span className="flex-1 text-sm font-semibold">Debug</span>{tab !== "logs" && <Button size="icon-sm" variant="ghost" aria-label="Clear logs" onClick={clear}><Trash2Icon /></Button>}<Button size="icon-sm" variant="ghost" aria-label="Close developer tools" onClick={close}><XIcon /></Button></header>
    <div role="tablist" aria-label="Developer tools" className="flex gap-1 border-b p-2">{(["console","network","logs"] as const).map(value => <Button key={value} role="tab" aria-selected={tab === value} variant={tab === value ? "secondary" : "ghost"} size="sm" onClick={() => setTab(value)}>{value === "console" ? "Console" : value === "network" ? "Network" : "Logs"}{value !== "logs" && <span className="text-xs tabular-nums">{entries.filter(e => e.kind === value).length}</span>}</Button>)}</div>
    {tab === "logs" ? <div role="tabpanel" aria-label="Service logs" className="flex min-h-0 flex-1 flex-col">{serviceLogs}</div> : <>
    <div className="flex flex-wrap items-center gap-3 border-b p-2"><Input aria-label="Filter logs" placeholder={tab === "console" ? "Filter console messages…" : "Filter requests…"} value={filter} onChange={e => setFilter(e.target.value)} /><label className="flex shrink-0 items-center gap-1 text-xs"><input type="checkbox" checked={errorsOnly} onChange={e => setErrorsOnly(e.target.checked)} />Errors only</label>{tab === "network" && <label className="flex shrink-0 items-center gap-1 text-xs"><input type="checkbox" checked={xhrOnly} onChange={e => setXhrOnly(e.target.checked)} />XHR only</label>}</div>
    <div role="tabpanel" aria-label={tab === "console" ? "Console logs" : "Network logs"} className="min-h-0 flex-1 overflow-auto">
      {!connected && <p className="p-4 text-xs leading-relaxed text-muted-foreground">Waiting for preview diagnostics. Capture is available for Gantry-managed Vite pages; reload the preview to reconnect.</p>}
      {connected && !rows.length && <p className="p-4 text-xs text-muted-foreground">{filter || errorsOnly ? "No matching entries." : tab === "console" ? "No console messages yet." : "No requests yet. Interact with the preview to see traffic."}</p>}
      {rows.map(e => <details key={e.id} className={`border-b px-3 py-2 text-xs ${e.level === "error" || e.status === 0 || (e.status ?? 0) >= 400 ? "bg-destructive/5 text-destructive" : e.level === "warn" ? "bg-amber-500/5 text-amber-800 dark:text-amber-300" : ""}`}><summary className="cursor-pointer list-none space-y-1"><div className="flex items-center gap-2 text-[11px] text-muted-foreground"><time>{new Date(e.time).toLocaleTimeString()}</time><span className="uppercase">{e.level ?? e.method}</span>{e.kind === "network" && <><span className={`rounded border px-1.5 py-0.5 font-semibold ${e.status === 0 || (e.status ?? 0) >= 400 ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300" : (e.status ?? 0) >= 200 && (e.status ?? 0) < 300 ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-border"}`}>{e.status === 0 ? "Failed" : e.status ?? "—"}</span><span className="ml-auto tabular-nums">{e.duration} ms</span></>}</div><div className="break-all whitespace-pre-wrap font-mono leading-relaxed line-clamp-3">{e.message ?? e.url}</div></summary>{e.kind === "network" ? <NetworkDetails entry={e} /> : <pre className="mt-2 whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono text-xs text-foreground">{e.message}</pre>}</details>)}
    </div>
    <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">Latest 500 entries · this preview only · kept in memory</p></>}
  </aside>;
}


function NetworkDetails({entry}: {entry: DiagnosticEntry}) {
  const [tab,setTab] = useState<"request" | "response">("request");
  const headers = tab === "request" ? entry.requestHeaders : entry.responseHeaders;
  const raw = tab === "request" ? entry.requestBody : entry.responseBody;
  let body = raw;
  try { if (raw) body = JSON.stringify(JSON.parse(raw),null,2); } catch {}
  return <div className="mt-2 space-y-2 text-foreground">
    <div role="tablist" aria-label="Request details" className="flex gap-1">{(["request","response"] as const).map(value => <Button key={value} role="tab" aria-selected={tab === value} variant={tab === value ? "secondary" : "ghost"} size="sm" onClick={() => setTab(value)}>{value === "request" ? "Request" : "Response"}</Button>)}</div>
    <div role="tabpanel" aria-label={tab === "request" ? "Request details" : "Response details"} className="space-y-2">
      <p className="break-all font-mono">{entry.method} {entry.url}</p>
      {entry.error && <p className="text-destructive">{entry.error}</p>}
      <p className="font-semibold">Headers</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2">{headers ?? "Not captured for this resource."}</pre>
      <p className="font-semibold">Body</p><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2">{body ?? "Not captured for this resource."}</pre>
      <p className="text-[11px] text-muted-foreground">Browser-visible headers · bodies limited to 16 KB</p>
    </div>
  </div>;
}
