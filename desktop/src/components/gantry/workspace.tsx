"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRightIcon, GitBranchIcon, GitPullRequestIcon, LayoutListIcon, Loader2Icon, MonitorIcon, PlusIcon, RefreshCwIcon, MessageSquareIcon, CircleDashedIcon, CircleDotIcon, CircleCheckIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { SettingsLink } from "@/components/settings-link";
import { cn } from "@/lib/utils";
import { api } from "@/lib/client/api";
import { gantry, type ProjectView, type StatusView, type TicketView } from "@/lib/client/gantry";

import { useTicketColors } from "./ticket-colors";
import { Workspace as ReviewWorkspace } from "@/components/space/workspace";
import { PreviewPane } from "./preview-pane";
import { WorkspacePromptDialog } from "./workspace-prompt-dialog";
import { DeleteTicketDialog } from "./delete-ticket-dialog";
import { TicketDialog } from "./ticket-dialog";
import { TicketConversation, ticketChatRequest, openTicketChat } from "./ticket-chat";

type Area = "tickets" | "reviews" | "previews";
const labels: Record<string, string> = { backlog: "Backlog", in_progress: "In progress", done: "Done" };
const selectClass = "h-8 rounded-lg border bg-background px-2 text-sm focus-visible:outline-2 focus-visible:outline-ring";
const bridge = (url: string) => `/api/gantry${url}`;

function State({ value }: { value: string }) {
  return <Badge variant="outline" className={cn("shrink-0 capitalize", /failed|error/.test(value) && "text-destructive")}>{labels[value] || value.replaceAll("_", " ")}</Badge>;
}

export function GantryWorkspace() {
  const [reviewSpace, setReviewSpace] = useState<string | null>(null);
  const [data, setData] = useState<StatusView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState("");
  const [area, setArea] = useState<Area>("tickets");
  const [selected, setSelected] = useState<string | null>(null);
  const [ticketTab, setTicketTab] = useState<"details" | "preview">("details");
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropColumn, setDropColumn] = useState<string | null>(null);
  const [previewTicket, setPreviewTicket] = useState("main");
  const [promptOpen, setPromptOpen] = useState(false);
  const [deleting, setDeleting] = useState<TicketView | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingTicket, setEditingTicket] = useState(false);
  const [adding, setAdding] = useState(false);
  const [workspace, setWorkspace] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<{ title: string; text: string } | null>(null);
  const loading = useRef(false);
  const mounted = useRef(true);
  const refresh = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const next = await gantry.status();
      if (mounted.current) { setData(next); setError(null); }
    } catch (e) { if (mounted.current) setError((e as Error).message); }
    finally { loading.current = false; }
  }, []);
  useEffect(() => {
    mounted.current = true;
    queueMicrotask(() => {
      const params = new URLSearchParams(window.location.search);
      setProjectId(params.get("workspace") || localStorage.getItem("gantry-workspace") || "");
      setSelected(params.get("ticket"));
      if (params.get("review")) { setReviewSpace(params.get("review")); setArea("reviews"); }
      void refresh();
    });
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 10000);
    return () => { mounted.current = false; clearInterval(timer); };
  }, [refresh]);
  const project = data?.projects.find((p) => p.id === projectId) ?? data?.projects[0];
  const tickets = data?.tickets.filter((t) => t.projectId === project?.id) ?? [];
  const ticketColor = useTicketColors(project?.id ?? "", tickets);
  const doneBranch = (branch: string) => tickets.some(t => t.branch === branch && t.status !== "in_progress");
  const previews = data?.previews.filter((p) => p.projectId === project?.id && (p.isPrimary || !doneBranch(p.branch))) ?? [];
  const pulls = data?.pulls.filter((p) => p.projectId === project?.id && !doneBranch(p.branch)) ?? [];
  const ticket = tickets.find((t) => t.id === selected);
  const previewEntries = [{ id: "main", name: "Main", preview: previews.find(p => p.isPrimary) }, ...tickets.filter(t => t.status === "in_progress").map(t => ({ id: t.id, name: t.title.replace(/^.*\//, "").replace(/-+/g, " ").trim(), preview: previews.find(p => !p.isPrimary && p.branch === t.branch) }))];
  const activePreview = previewEntries.find(entry => entry.id === previewTicket) ?? previewEntries[0];
  const ticketPreviews = previews.filter(p => p.branch === ticket?.branch && !p.isPrimary);
  const jobs = data?.jobs.filter((j) => j.projectId === project?.id && ["queued", "running", "failed"].includes(j.state)).slice(0, 5) ?? [];

  async function act(action: () => Promise<unknown>, message?: string) {
    if (busy) return false;
    setBusy(true);
    try { await action(); if (message) toast.success(message); await refresh(); return true; }
    catch (e) { toast.error((e as Error).message); return false; }
    finally { setBusy(false); }
  }
  async function review(urls: string[], owner?: TicketView) {
    await act(async () => {
      const linked = owner ?? tickets.find(t => t.pullRequests.some(p => urls.includes(p.url)) || pulls.some(g => g.branch === t.branch && Object.values(g.pulls).some(p => urls.includes(p.url))));
      let targetSpace = linked?.reviewSpaceId;
      if (linked && !targetSpace) throw new Error("Ticket space is not ready. Refresh Gantry and try again.");
      for (const url of urls) {
        const result = await api.addToSpace(url, targetSpace);
        targetSpace = result.space.id;
      }
      if (targetSpace) { setReviewSpace(targetSpace); setArea("reviews"); setSelected(null); setCreating(false); }
    });
  }
  async function showLog(title: string, url: string) {
    await act(async () => {
      const response = await fetch(bridge(url));
      if (!response.ok) throw new Error("Could not load this log. Refresh and try again.");
      setLog({ title, text: await response.text() });
    });
  }
  function openTicket(id: string, preview = false, edit = false) {
    setEditingTicket(edit);
    setSelected(id); setCreating(false); setLog(null);
    setTicketTab(preview ? "preview" : "details");
  }
  function closeTicket() {
    setSelected(null); setCreating(false); setLog(null); setEditingTicket(false);
    const params = new URLSearchParams(window.location.search); params.delete("ticket");
    window.history.replaceState(null, "", `/?${params}`);
  }
  async function moveTicket(id: string, status: string) {
    setDragging(null); setDropColumn(null);
    const moving = tickets.find(t => t.id === id);
    if (!moving || moving.status === status) return;
    await act(async () => { await gantry.updateTicket(id, { status }); await refresh(); if (status === "in_progress") await openTicketChat(id); }, `Moved to ${labels[status]}`);
  }
  const activeProjectId = project?.id;
  useEffect(() => {
    if (!activeProjectId) return;
    const params = new URLSearchParams(window.location.search);
    params.set("workspace", activeProjectId);
    if (area === "reviews" && reviewSpace) params.set("review", reviewSpace);
    else params.delete("review");
    params.delete("ticket");
    window.history.replaceState(null, "", `/?${params}`);
  }, [area, reviewSpace, activeProjectId]);
  const navigateReview = useCallback((id: string | null) => { setReviewSpace(id); setArea(current => id ? "reviews" : current === "reviews" ? "tickets" : current); }, []);
  const changeArea = (next: Area) => { setArea(next); setLog(null); setCreating(false); };

  return <div className="gantry-workspace flex h-full min-h-0 flex-col bg-background">
    {promptOpen && project && <WorkspacePromptDialog project={project} onClose={() => setPromptOpen(false)} />}
    {deleting && <DeleteTicketDialog title={deleting.title} busy={busy} onCancel={() => setDeleting(null)} onDelete={() => void act(() => gantry.deleteTicket(deleting.id), "Ticket deleted").then(ok => { if (ok) { if (selected === deleting.id) closeTicket(); setDeleting(null); } })} />}
    <header className="app-bar flex h-12 shrink-0 items-center gap-3 border-b px-4">
      <span className="flex items-center gap-2 text-sm font-semibold"><LayoutListIcon className="size-5 text-violet-600 dark:text-violet-300" />Gantry</span>
      <div className="flex-1" /><span className="hidden text-xs text-muted-foreground sm:block" role="status">{error ? "Connection interrupted" : data ? "Connected locally" : "Connecting…"}</span>
      <SettingsLink /><ThemeToggle />
    </header>
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <aside className="flex max-h-[35dvh] overflow-y-auto md:max-h-none shrink-0 flex-col gap-5 border-b bg-muted/20 p-4 md:w-56 md:border-r md:border-b-0">
        <div className="space-y-2"><label htmlFor="gantry-project" className="text-xs font-medium text-muted-foreground">Workspace</label>
          <select id="gantry-project" className={cn(selectClass, "w-full")} value={project?.id ?? ""} onChange={(e) => { setReviewSpace(null); setArea("tickets"); setProjectId(e.target.value); localStorage.setItem("gantry-workspace", e.target.value); setSelected(null); setCreating(false); setLog(null); }}>
            {!data?.projects.length && <option value="">No workspace connected</option>}
            {data?.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <nav aria-label="Gantry workspace" className="flex gap-1 md:flex-col">
          {([["tickets", "Tickets", LayoutListIcon, tickets.filter(t => t.status === "in_progress").length], ["reviews", "Reviews", GitPullRequestIcon, pulls.length]] as const).map(([id, label, Icon, count]) =>
            <Button key={id} variant={area === id ? "secondary" : "ghost"} className={cn("justify-start", area === id && (id === "tickets" ? "gantry-nav-tickets" : "gantry-nav-reviews"))} aria-current={area === id ? "page" : undefined} onClick={() => changeArea(id)}><Icon />{label}<span className="ml-auto pl-3 text-xs tabular-nums text-muted-foreground">{count}</span></Button>)}
        </nav>
        {project && <nav aria-label="Previews" className="space-y-1"><h2 className="mb-2 flex items-center gap-2 px-2 text-xs font-semibold text-muted-foreground"><MonitorIcon className="size-4" />Previews</h2>{previewEntries.map(entry => <Button key={entry.id} variant={area === "previews" && activePreview.id === entry.id ? "secondary" : "ghost"} className={cn("h-auto min-h-8 w-full justify-start pl-6 text-left", area === "previews" && activePreview.id === entry.id && "gantry-nav-reviews")} aria-current={area === "previews" && activePreview.id === entry.id ? "page" : undefined} onClick={() => { setPreviewTicket(entry.id); changeArea("previews"); closeTicket(); }}><span className="min-w-0 whitespace-normal break-words">{entry.name}</span></Button>)}</nav>}
        <div className="mt-auto space-y-3">
          {project && <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => setPromptOpen(true)}><MessageSquareIcon />Workspace prompt</Button>}
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => setAdding(!adding)}><PlusIcon /> Add workspace</Button>
          {project && <p className="break-all text-xs leading-relaxed text-muted-foreground">{project.workspace}</p>}
        </div>
      </aside>
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">
        {area !== "previews" && !(area === "reviews" && reviewSpace) && <div className="flex flex-wrap items-center gap-3 border-b px-6 py-5">
          <div className="min-w-0 flex-1"><h1 className="text-xl font-semibold">{area === "tickets" ? "Tickets" : "Ready for review"}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{area === "tickets" ? "Create a worktree, build the feature, and open a pull request." : "Review related pull requests together."}</p></div>
          <Button variant="outline" disabled={busy} onClick={() => void refresh()} aria-label="Refresh Gantry"><RefreshCwIcon /></Button>
          {area === "tickets" && project && <Button disabled={busy} onClick={() => { setCreating(true); setSelected(null); setLog(null); setTicketTab("details"); }}><PlusIcon /> New ticket</Button>}
          {area === "reviews" && project && <Button variant="outline" disabled={busy} onClick={() => void act(() => gantry.refreshProject(project.id), "Remote sync queued")}><RefreshCwIcon /> Sync remote</Button>}
        </div>}
        {error && <div role="alert" className="border-b bg-destructive/5 px-6 py-3 text-sm text-destructive">{error} {data && "Showing the last loaded state."}</div>}
        {adding && <form className="flex flex-wrap items-end gap-3 border-b p-6" onSubmit={(e) => { e.preventDefault(); void act(() => gantry.addProject(workspace.trim()), "Workspace connected").then((ok) => { if (ok) { setAdding(false); setWorkspace(""); } }); }}>
          <label className="min-w-64 flex-1 space-y-2 text-sm">Workspace folder<Input value={workspace} onChange={(e) => setWorkspace(e.target.value)} placeholder="/path/to/repository or workspace" required /></label>
          <Button type="submit" disabled={busy || !workspace.trim()}>Connect workspace</Button><Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
        </form>}
        {!data && !error && <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2Icon className="size-4 animate-spin" /> Loading your workspaces…</div>}
        {data && !project && <div className="max-w-xl space-y-3 p-8"><h2 className="text-lg font-medium">Connect your first workspace</h2><p className="text-sm leading-relaxed text-muted-foreground">Choose a Git repository or a folder of repositories. Gantry creates local configuration automatically. Configure your provider once in Settings, then start a ticket.</p><Button onClick={() => setAdding(true)}>Add workspace</Button></div>}
        {area !== "previews" && jobs.length > 0 && <details className="border-b px-6 py-3 text-xs text-muted-foreground"><summary className="cursor-pointer">Activity · {jobs.length} recent jobs</summary><div className="mt-3 space-y-2">{jobs.map((j) => <div key={j.id} className="flex flex-wrap items-center gap-2"><State value={j.state} /><span>{j.kind} · {j.detail || j.phase || j.error || "Queued"}</span>{j.error && <span className="text-destructive">{j.error}</span>}</div>)}</div></details>}

        {project && area === "previews" && <PreviewPane key={`${project.id}:${activePreview.id}`} name={activePreview.name} preview={activePreview.preview} refresh={refresh} />}
        {project && area === "tickets" && <div className="min-h-0 flex-1">
          <section className="grid grid-cols-1 divide-y md:grid-cols-3 md:divide-x md:divide-y-0" aria-label="Ticket board">
            {["backlog", "in_progress", "done"].map(status => {
              const column = tickets.filter(t => t.status === status).sort((a,b) => (a.position ?? 0) - (b.position ?? 0));
              return <section key={status} className={cn("gantry-column min-h-64 min-w-0 p-4 transition-colors", dropColumn === status && "bg-muted")} aria-label={labels[status]} onDragOver={e => { if (dragging && !busy) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDropColumn(status); } }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropColumn(null); }} onDrop={e => { e.preventDefault(); if (!busy) void moveTicket(e.dataTransfer.getData("application/x-gantry-ticket"), status); }}>
                <h2 className={cn("mb-4 flex items-center gap-2 text-sm font-medium", status === "backlog" ? "text-violet-700 dark:text-violet-300" : status === "in_progress" ? "text-sky-700 dark:text-sky-300" : "text-emerald-700 dark:text-emerald-300")}>
                  {status === "backlog" ? <CircleDashedIcon className="size-4" /> : status === "in_progress" ? <CircleDotIcon className="size-4" /> : <CircleCheckIcon className="size-4" />}{labels[status]}<span className="ml-auto rounded-md bg-current/10 px-2 py-0.5 text-xs tabular-nums">{column.length}</span></h2>
                <div className="space-y-3">{column.map(t => <article key={t.id} style={ticketColor(t.id)} data-ticket-id={t.id} data-done={t.status === "done" || undefined} draggable={!busy} onDragStart={e => { e.dataTransfer.setData("application/x-gantry-ticket", t.id); e.dataTransfer.effectAllowed = "move"; setDragging(t.id); }} onDragEnd={() => { setDragging(null); setDropColumn(null); }} className={cn("gantry-ticket rounded-lg border", selected === t.id && "gantry-ticket-selected", dragging === t.id && "opacity-50")}>
                  <button onClick={() => openTicket(t.id)} className="flex w-full flex-col gap-3 p-3 text-left focus-visible:outline-2 focus-visible:outline-ring" aria-pressed={selected === t.id}>
                    <span className="flex items-start gap-2 break-words text-sm font-semibold"><span aria-hidden="true" className="gantry-ticket-dot mt-1 size-2 shrink-0 rounded-full" />{t.title}</span>
                    <span className="flex max-w-full items-center gap-1.5 text-xs text-muted-foreground"><GitBranchIcon className="size-3 shrink-0" /><span className="truncate font-mono">{t.branch}</span></span>
                    {t.run && <span className="text-xs text-muted-foreground">{t.run.agent} · {t.run.state}</span>}
                  </button>
                  <div className="gantry-ticket-actions flex flex-wrap gap-1 border-t px-2 py-1"><Button size="sm" variant="ghost" onClick={() => openTicket(t.id, false, true)} aria-label={`Edit ticket ${t.title}`}>Edit</Button>{t.status === "in_progress" && <><Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(() => openTicketChat(t.id))} aria-label={`Open chat for ${t.title}`}><MessageSquareIcon />Open chat</Button><Button size="sm" variant="ghost" disabled={busy || !t.reviewSpaceId} onClick={() => void review([], t)} aria-label={`Open review space for ${t.title}`}><GitPullRequestIcon />Review<ArrowUpRightIcon /></Button><Button size="sm" variant="ghost" onClick={() => openTicket(t.id, true)} aria-label={`Preview ${t.title}`}><MonitorIcon />Preview</Button></>}<Button size="sm" variant="ghost" className="ml-auto" disabled={busy || !!(t.run && ["starting", "running", "interrupting"].includes(t.run.state))} onClick={() => setDeleting(t)} aria-label={`Delete ticket ${t.title}`}><Trash2Icon />Delete</Button></div>
                </article>)}</div>
                {!column.length && <p className="py-6 text-xs text-muted-foreground">{status === "backlog" ? "New tickets start here." : status === "in_progress" ? "Active work appears here." : "Completed tickets appear here."}</p>}
              </section>;
            })}
          </section>
          {(creating || ticket) && <TicketDialog color={ticket ? ticketColor(ticket.id) : undefined} title={creating ? "New ticket" : ticket!.title} onClose={closeTicket}>
            {ticket && <div className="flex shrink-0 gap-1 border-b px-6 py-2" role="tablist" aria-label="Ticket sections">{(["details", ...(ticket.status === "in_progress" ? ["preview"] : [])] as ("details" | "preview")[]).map(tab => <Button key={tab} role="tab" aria-selected={ticketTab === tab} variant={ticketTab === tab ? "secondary" : "ghost"} onClick={() => { setTicketTab(tab); setLog(null); }}>{tab === "details" ? "Details" : "Preview"}</Button>)}</div>}
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
            {log && <section className="border-b p-6"><div className="mb-3 flex items-center justify-between gap-3"><h2 className="font-medium">{log.title}</h2><Button variant="ghost" size="sm" onClick={() => setLog(null)}>Close log</Button></div><pre className="max-h-80 overflow-auto rounded-lg bg-muted p-4 font-mono text-xs leading-relaxed">{log.text || "No output yet."}</pre></section>}
            {(creating || ticketTab === "details") && <section id="ticket-details" aria-label="Ticket details">
            <div className="max-w-3xl">{creating ? <TicketForm key={`new-${project.id}`} project={project} busy={busy} onCancel={() => setCreating(false)} onSave={async (input) => { await act(async () => { const t = await gantry.createTicket(project.id, input); setSelected(t.id); setCreating(false); }); }} /> : ticket &&
              <TicketDetail key={ticket.id} editing={editingTicket} setEditing={setEditingTicket} ticket={ticket} project={project} busy={busy} act={act} onReview={(urls) => review(urls, ticket)} onLog={showLog} onDeleted={closeTicket} onStage={status => moveTicket(ticket.id, status)} />}</div></section>}
        {ticket && ticketTab === "preview" && ticket.status === "in_progress" && <section id="ticket-preview" aria-label="Ticket preview" className="divide-y"><h3 className="pb-4 text-sm font-medium">Preview</h3>{ticketPreviews.map((p) => <section key={p.id} className="space-y-4 p-6">
          <div className="flex flex-wrap items-center gap-3"><GitBranchIcon className="size-4 text-muted-foreground" /><h2 className="min-w-0 break-all font-medium">{p.isPrimary ? "Main workspace" : p.branch}</h2><State value={p.paused ? "paused" : p.status} /><div className="flex-1" />
            {!p.archived && !p.retired && !p.removed ? <><Button size="sm" variant="outline" disabled={busy} onClick={() => void act(() => gantry.previewAction(p.id, p.paused ? "resume" : "pause"))}>{p.paused ? "Resume" : "Pause"}</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(() => gantry.previewAction(p.id, "restart"))}>Restart</Button></> : <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(() => gantry.previewAction(p.id, "restore"))}>Restore</Button>}
          </div>
          <div className="space-y-2">{p.services.map((s) => <div key={s.id} className="flex flex-wrap items-center gap-3 text-sm"><span className="w-28 truncate font-medium">{s.id}</span><State value={s.state} /><span className="font-mono text-xs text-muted-foreground">{s.port ? `:${s.port}` : ""}</span>{s.openLink && s.state === "ready" && <a href={s.openLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs underline underline-offset-4">Open preview<ArrowUpRightIcon className="size-3" /></a>}{s.logUrl && <Button size="xs" variant="ghost" disabled={busy} onClick={() => void showLog(`${s.id} log`, s.logUrl!)}>Logs</Button>}{s.error && <p className="w-full break-words text-xs text-destructive">{s.error}</p>}</div>)}</div>
          <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Checkouts and environment</summary><div className="mt-3 space-y-2">{p.checkouts.map((c) => <p key={c.repositoryId} className="break-all">{c.repositoryId} · {c.path}</p>)}{project.environments.length > 0 && <label className="flex items-center gap-2">Environment<select className={selectClass} value={p.environment ?? project.environments.find((e) => e.default)?.id ?? ""} disabled={busy} onChange={(e) => void act(() => gantry.previewAction(p.id, "environment", { environmentId: e.target.value }))}>{project.environments.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}</select></label>}</div></details>
        </section>)}{!ticketPreviews.length && <p className="p-6 text-sm text-muted-foreground">No preview for this ticket yet. Create its worktrees from Details or start work in Chat.</p>}</section>}
          </div></TicketDialog>}
        </div>}
        {project && reviewSpace && <div className={area === "reviews" ? "flex min-h-0 flex-1 flex-col" : "hidden"}><ReviewWorkspace key={reviewSpace} spaceId={reviewSpace} initialTarget={null} initialFile={null} onNavigateSpace={navigateReview} /></div>}
        {project && area === "reviews" && !reviewSpace && <div className="divide-y">{pulls.map((g) => <section key={g.id} className="space-y-4 p-6"><div className="flex flex-wrap items-center gap-3"><GitBranchIcon className="size-4 text-muted-foreground" /><h2 className="min-w-0 flex-1 break-all font-medium">{g.branch}</h2><State value={g.ready ? "ready" : "blocked"} /><Button size="sm" disabled={busy} onClick={() => void review(Object.values(g.pulls).map((p) => p.url))}>Review {Object.keys(g.pulls).length > 1 ? "together" : "PR"}<ArrowUpRightIcon /></Button></div>
          {Object.entries(g.pulls).map(([repo, p]) => <div key={repo} className="flex flex-wrap items-center gap-3 text-sm"><GitPullRequestIcon className="size-4 shrink-0 text-muted-foreground" /><button className="min-w-0 flex-1 break-words text-left hover:underline" disabled={busy} onClick={() => void review([p.url])}>{repo} #{p.number} · {p.title}</button><a href={p.url} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground underline underline-offset-4">GitHub</a></div>)}{g.blockers.length > 0 && <p className="text-xs text-muted-foreground">{g.blockers.join(" · ")}</p>}
        </section>)}{!pulls.length && <p className="p-6 text-sm text-muted-foreground">No open pull requests. Sync remote to check for new reviews.</p>}</div>}
      </main>
    </div>
  </div>;
}

type TicketInput = { title: string; description: string; scope: string; branch?: string };
function TicketForm({ project, ticket, busy, onSave, onCancel }: { project: ProjectView; ticket?: TicketView; busy: boolean; onSave: (input: TicketInput) => Promise<void>; onCancel: () => void }) {
  const [title, setTitle] = useState(ticket?.title ?? "");
  const [branch, setBranch] = useState(ticket?.branch ?? "");
  const [description, setDescription] = useState(ticket?.description ?? "");
  const [scope, setScope] = useState(ticket?.scope ?? project.scopes[0]?.id ?? "both");
  return <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); void onSave({ title: title.trim(), description, scope, ...(branch.trim() ? { branch: branch.trim() } : {}) }); }}>
    <h2 className="text-lg font-semibold">{ticket ? "Edit ticket" : "New ticket"}</h2>
    <label className="block space-y-2 text-sm">Title<Input autoFocus required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs to change?" /></label>
    <label className="block space-y-2 text-sm">Branch<Input aria-label="Branch" value={branch} onChange={e => setBranch(e.target.value)} placeholder="Generated from title if empty" /></label>
    <label className="block space-y-2 text-sm">Notes<Textarea aria-label="Notes" className="min-h-32" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Context, expected behavior, and acceptance criteria" /></label>
    <label className="flex items-center gap-3 text-sm">Scope<select className={selectClass} value={scope} onChange={(e) => setScope(e.target.value)}>{project.scopes.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
    <div className="flex gap-2"><Button type="submit" disabled={busy || !title.trim()}>{busy && <Loader2Icon className="animate-spin" />}{ticket ? "Save changes" : "Create ticket"}</Button><Button variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button></div>
  </form>;
}

function TicketDetail({ ticket: t, project, busy, act, onReview, onLog, onDeleted, editing, setEditing, onStage }: { onStage: (status: string) => Promise<void>; editing: boolean; setEditing: (value: boolean) => void; ticket: TicketView; project: ProjectView; busy: boolean; act: (action: () => Promise<unknown>, message?: string) => Promise<boolean>; onReview: (urls: string[]) => Promise<void>; onLog: (title: string, url: string) => Promise<void>; onDeleted: () => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const running = t.run && ["starting", "running", "interrupting"].includes(t.run.state);
  if (editing) return <TicketForm project={project} ticket={t} busy={busy} onCancel={() => setEditing(false)} onSave={async (input) => { if (await act(() => gantry.updateTicket(t.id, input))) setEditing(false); }} />;
  return <div className="space-y-6">
    <div className="space-y-3"><div className="flex items-start gap-3"><h2 className="min-w-0 flex-1 break-words text-lg font-semibold">{t.title}</h2><Button variant="ghost" size="sm" disabled={busy} onClick={() => { setEditing(true); }}>Edit</Button></div><p className="break-all font-mono text-xs text-muted-foreground">{t.branch}</p>
      <label className="flex items-center gap-3 text-sm">Stage<select className={selectClass} value={t.status} disabled={busy} onChange={(e) => void onStage(e.target.value)}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{t.description || "No notes added."}</p>
    </div>
    {t.status === "in_progress" && <section className="space-y-3 border-t pt-5"><TicketConversation ticketId={t.id} done={false} />
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || !!running} onClick={() => void act(() => ticketChatRequest(t.id, "prepare"), "Ticket worktrees are ready")}>Create worktrees</Button></div>
      {t.run && <div className="flex flex-wrap items-center gap-2"><State value={t.run.state} /><Button size="sm" variant="ghost" disabled={busy} onClick={() => void onLog("Previous agent output", t.run!.logUrl)}>View previous output</Button>{running && <Button variant="outline" disabled={busy} onClick={() => void act(() => gantry.handoffTicket(t.id), "Previous agent stopped. You can continue in Chat.")}>Take over</Button>}</div>}
    </section>}
    {t.status === "in_progress" && <section className="space-y-3 border-t pt-5"><h3 className="text-sm font-medium">Review space</h3><p className="text-sm text-muted-foreground">All pull requests for this ticket stay together in its own space.</p><Button disabled={busy || !t.reviewSpaceId} onClick={() => void onReview([])}>Open ticket space<ArrowUpRightIcon /></Button>{t.pullRequests.map((p) => <Button key={p.url} variant="outline" size="sm" disabled={busy} onClick={() => void onReview([p.url])}>Review {p.role} #{p.number}</Button>)}{t.artifacts.map((a) => <a key={a.file} href={bridge(a.url)} target="_blank" rel="noreferrer" className="block text-sm underline underline-offset-4">{a.label}</a>)}</section>}
    <div className="border-t pt-5">{confirmDelete ? <div className="space-y-3"><p className="text-sm">Delete this ticket? Its worktrees and pull requests will remain.</p><div className="flex gap-2"><Button variant="destructive" disabled={busy} onClick={() => void act(() => gantry.deleteTicket(t.id)).then((ok) => { if (ok) onDeleted(); })}>Delete ticket</Button><Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button></div></div> : <Button variant="ghost" size="sm" disabled={busy || !!running} onClick={() => setConfirmDelete(true)}>Delete ticket…</Button>}</div>
  </div>;
}
