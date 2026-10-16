"use client";
import { useEffect, useRef, useState } from "react";
import { XIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type DiagnosticEntry = { id: number; time: number; kind: "console" | "network"; level?: string; message?: string; method?: string; url?: string; status?: number | null; duration?: number; requestType?: string; error?: string };
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
      } else if (event.data?.type === "entry" && valid(event.data.entry)) {
        setEntries(old => [...old, event.data.entry].slice(-500));
      }
    };
    element.contentWindow.postMessage({type:"gantry-diagnostics-connect"}, new URL(element.src).origin, [next.port2]);
  }
  return {frame, entries, connected, connect, clear: () => setEntries([])};
}
export function PreviewDiagnostics({ entries, connected, clear, close }: { entries: DiagnosticEntry[]; connected: boolean; clear: () => void; close: () => void }) {
  const [tab, setTab] = useState<"console" | "network">("console");
  const [filter, setFilter] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const rows = entries.filter(e => e.kind === tab && (!errorsOnly || e.level === "error" || (e.status !== undefined && e.status !== null && (e.status === 0 || e.status >= 400))) && `${e.message ?? ""} ${e.method ?? ""} ${e.url ?? ""} ${e.status ?? ""}`.toLowerCase().includes(filter.toLowerCase()));
  return <aside aria-label="Preview developer tools" className="absolute inset-y-0 right-0 z-10 flex w-[min(30rem,100%)] flex-col border-l bg-background shadow-xl xl:static xl:w-[28rem] xl:shrink-0 xl:shadow-none">
    <header className="flex items-center gap-2 border-b px-3 py-2"><span className="flex-1 text-sm font-semibold">Console & Network</span><Button size="icon-sm" variant="ghost" aria-label="Clear logs" onClick={clear}><Trash2Icon /></Button><Button size="icon-sm" variant="ghost" aria-label="Close developer tools" onClick={close}><XIcon /></Button></header>
    <div role="tablist" aria-label="Developer tools" className="flex gap-1 border-b p-2">{(["console","network"] as const).map(value => <Button key={value} role="tab" aria-selected={tab === value} variant={tab === value ? "secondary" : "ghost"} size="sm" onClick={() => setTab(value)}>{value === "console" ? "Console" : "Network"}<span className="text-xs tabular-nums">{entries.filter(e => e.kind === value).length}</span></Button>)}</div>
    <div className="flex items-center gap-3 border-b p-2"><Input aria-label="Filter logs" placeholder={tab === "console" ? "Filter console messages…" : "Filter requests…"} value={filter} onChange={e => setFilter(e.target.value)} /><label className="flex shrink-0 items-center gap-1 text-xs"><input type="checkbox" checked={errorsOnly} onChange={e => setErrorsOnly(e.target.checked)} />Errors only</label></div>
    <div role="tabpanel" aria-label={tab === "console" ? "Console logs" : "Network logs"} className="min-h-0 flex-1 overflow-auto">
      {!connected && <p className="p-4 text-xs leading-relaxed text-muted-foreground">Waiting for preview diagnostics. Capture is available for Gantry-managed Vite pages; reload the preview to reconnect.</p>}
      {connected && !rows.length && <p className="p-4 text-xs text-muted-foreground">{filter || errorsOnly ? "No matching entries." : tab === "console" ? "No console messages yet." : "No requests yet. Interact with the preview to see traffic."}</p>}
      {rows.map(e => <details key={e.id} className={`border-b px-3 py-2 text-xs ${e.level === "error" || e.status === 0 || (e.status ?? 0) >= 400 ? "bg-destructive/5 text-destructive" : e.level === "warn" ? "bg-amber-500/5 text-amber-800 dark:text-amber-300" : ""}`}><summary className="cursor-pointer list-none space-y-1"><div className="flex items-center gap-2 text-[11px] text-muted-foreground"><time>{new Date(e.time).toLocaleTimeString()}</time><span className="uppercase">{e.level ?? e.method}</span>{e.kind === "network" && <><span>{e.status === 0 ? "Failed" : e.status ?? "—"}</span><span className="ml-auto tabular-nums">{e.duration} ms</span></>}</div><div className="break-all whitespace-pre-wrap font-mono leading-relaxed line-clamp-3">{e.message ?? e.url}</div></summary><pre className="mt-2 whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono text-xs text-foreground">{e.kind === "console" ? e.message : `${e.method} ${e.url}\nStatus: ${e.status === 0 ? "Failed" : e.status ?? "Not exposed by browser"}\nType: ${e.requestType}\nDuration: ${e.duration} ms${e.error ? `\n${e.error}` : ""}`}</pre></details>)}
    </div>
    <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">Latest 500 entries · this preview only · kept in memory</p>
  </aside>;
}
