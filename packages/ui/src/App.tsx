import { ticketServiceScopes } from '../../shared/src/ticket.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type StatusView, type ProjectView, type TicketView } from './api.js';
import { Chip, ConfirmDialog, stateTone } from './common.js';
import { prLensLink } from './pr-lens.js';

const TABS = [
  ['tickets', 'Tickets'],
  ['previews', 'Previews'],
  ['pulls', 'Pull requests'],
] as const;

type TabName = (typeof TABS)[number][0];

export function App() {
  const [status, setStatus] = useState<StatusView | null>(null);
  const [connected, setConnected] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<TabName>(() => (localStorage.getItem('gantry.tab') as TabName) ?? 'tickets');
  const [projectId, setProjectId] = useState<string>(() => localStorage.getItem('gantry.project') ?? '');
  const [addWorkspace, setAddWorkspace] = useState<string>('');
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await api.status();
      setStatus(next);
      setConnected(true);
    } catch {
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), status?.jobs.length ? 1500 : 4000);
    return () => clearInterval(timer);
  }, [refresh, status?.jobs.length]);

  useEffect(() => {
    if (projectId && status?.projects.some((project) => project.id === projectId)) return;
    if (status?.projects.length) {
      const first = status.projects[0]!.id;
      if (first !== projectId) {
        setProjectId(first);
        localStorage.setItem('gantry.project', first);
      }
    }
  }, [status, projectId]);

  const project = useMemo(() => status?.projects.find((candidate) => candidate.id === projectId) ?? null, [status, projectId]);
  const scoped = useMemo(() => (project ? status! : null), [project, status]);

  const run = useCallback(async (action: () => Promise<unknown>) => {
    try {
      await action();
      await refresh();
      return true;
    } catch (error) {
      setNotice((error as Error).message);
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      noticeTimer.current = setTimeout(() => setNotice(null), 6000);
      return false;
    }
  }, [refresh]);

  if (!scoped || !project) {
    return (
      <>
        <TopBar connected={connected} status={status} />
        <main>
          <div className="empty-state">
            {connected
              ? 'No projects registered yet. Enter the path to a workspace containing gantry.yaml (run "gantry init" inside a workspace to scaffold one).'
              : 'Gantry is not reachable. Start it with: gantry serve'}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 14 }}>
              <input
                style={{ maxWidth: 480 }}
                placeholder="/absolute/path/to/workspace"
                value={addWorkspace}
                onChange={(event) => setAddWorkspace(event.target.value)}
              />
              <button
                className="primary"
                onClick={() => void run(async () => {
                  await api.addProject(addWorkspace);
                  setAddWorkspace('');
                })}
              >
                Add project
              </button>
            </div>
          </div>
        </main>
      </>
    );
  }

  const tickets = scoped.tickets.filter((ticket) => ticket.projectId === project.id);
  const previews = scoped.previews.filter((preview) => preview.projectId === project.id);
  const pulls = scoped.pulls.filter((group) => group.projectId === project.id);

  return (
    <>
      <TopBar connected={connected} status={status} projects={scoped.projects} projectId={project.id} onProject={(id) => { setProjectId(id); localStorage.setItem('gantry.project', id); }} />
      <nav className="tabs" role="tablist">
        {TABS.map(([name, label]) => (
          <button key={name} role="tab" aria-selected={tab === name} onClick={() => { setTab(name); localStorage.setItem('gantry.tab', name); }}>
            {label}
            {name === 'tickets' ? ` (${tickets.filter((t) => t.status !== 'done').length})` : name === 'previews' ? ` (${previews.filter((p) => !p.archived && !p.retired).length})` : ` (${pulls.length})`}
          </button>
        ))}
      </nav>
      {notice ? <p className="notice" role="alert">{notice}</p> : null}
      <main>
        {tab === 'tickets' ? <TicketsBoard project={project} tickets={tickets} jobs={scoped.jobs} run={run} refresh={refresh} setNotice={setNotice} /> : null}
        {tab === 'previews' ? <PreviewsBoard project={project} previews={previews} run={run} /> : null}
        {tab === 'pulls' ? <PullsBoard project={project} pulls={pulls} run={run} /> : null}
      </main>
    </>
  );
}

function TopBar({ connected, status, projects, projectId, onProject }: {
  connected: boolean;
  status: StatusView | null;
  projects?: ProjectView[];
  projectId?: string;
  onProject?: (id: string) => void;
}) {
  return (
    <header className="topbar">
      <div className="brand"><span className="crane">⛁</span> Gantry <small>local development control plane</small></div>
      {projects && projects.length > 1 ? (
        <select style={{ width: 'auto' }} value={projectId} onChange={(event) => onProject?.(event.target.value)}>
          {projects.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
          ))}
        </select>
      ) : null}
      <div className="spacer" />
      <span className="conn {connected ? 'ok' : 'down'}"></span>
      <span className={`conn ${connected ? 'ok' : 'down'}`}>
        {connected
          ? `port ${status?.host.port ?? '…'} · synced ${status?.remoteSync.lastSyncAt ? new Date(status.remoteSync.lastSyncAt).toLocaleTimeString() : 'never'}`
          : 'Gantry is offline'}
      </span>
      <a href="https://github.com/branchboard/gantry" target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>Docs</a>
    </header>
  );
}

const COLUMNS: [string, string, string][] = [
  ['backlog', 'Backlog', 'Ideas and work waiting to be picked up'],
  ['in_progress', 'In progress', 'Work currently moving through an agent'],
  ['done', 'Done', 'Completed work kept for reference'],
];

function TicketsBoard({ project, tickets, jobs, run, refresh, setNotice }: {
  project: ProjectView;
  tickets: TicketView[];
  jobs: StatusView['jobs'];
  run: (action: () => Promise<unknown>) => Promise<boolean>;
  refresh: () => Promise<void>;
  setNotice: (message: string) => void;
}) {
  const [editing, setEditing] = useState<TicketView | 'new' | null>(null);
  const [starting, setStarting] = useState<TicketView | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<TicketView | null>(null);
  const dragged = useRef<string | null>(null);

  return (
    <div className="board">
      {COLUMNS.map(([statusName, label, description]) => {
        const column = tickets.filter((ticket) => ticket.status === statusName);
        return (
          <section key={statusName} className="column" aria-label={label}>
            <div className="column-head">
              <h3>{label}</h3>
              <p>{description}</p>
              <span className="count">{column.length}</span>
            </div>
            <div className="ticket-list" data-status={statusName}
              onDragOver={(event) => { if (dragged.current) event.preventDefault(); }}
              onDrop={() => {
                const id = dragged.current;
                dragged.current = null;
                if (!id) return;
                const order = [...column.filter((candidate) => candidate.id !== id).map((candidate) => candidate.id)];
                order.unshift(id);
                void run(() => api.reorderTickets(project.id, statusName, order));
              }}
            >
              {column.map((ticket) => (
                <TicketCard
                  key={ticket.id}
                  ticket={ticket}
                  jobs={jobs}
                  scopes={project.scopes}
                  onEdit={() => setEditing(ticket)}
                  onStart={() => setStarting(ticket)}
                  onDelete={() => setConfirmDelete(ticket)}
                  onStatus={(next) => void run(() => api.updateTicket(ticket.id, { status: next }))}
                  onMove={(direction) => {
                    const index = column.findIndex((candidate) => candidate.id === ticket.id);
                    const other = column[index + direction];
                    if (!other) return;
                    const ids = column.map((candidate) => candidate.id);
                    const swapped = [...ids];
                    swapped[index] = ids[index + direction]!;
                    swapped[index + direction] = ids[index]!;
                    void run(() => api.reorderTickets(project.id, statusName, swapped));
                  }}
                  onDragStart={() => { dragged.current = ticket.id; }}
                />
              ))}
              {column.length === 0 ? <div className="column-empty">{statusName === 'backlog' ? 'Nothing waiting' : statusName === 'in_progress' ? 'Nothing in flight' : 'Nothing completed'}</div> : null}
            </div>
          </section>
        );
      })}
      <button className="primary" style={{ position: 'fixed', right: 22, bottom: 22, borderRadius: 999, padding: '10px 18px', boxShadow: 'var(--shadow)' }} onClick={() => setEditing('new')}>
        + New ticket
      </button>
      {editing ? (
        <TicketDialog
          project={project}
          ticket={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          run={run}
        />
      ) : null}
      {starting ? (
        <StartDialog
          project={project}
          ticket={starting}
          onClose={() => setStarting(null)}
          run={run}
          setNotice={setNotice}
          refresh={refresh}
        />
      ) : null}
      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete ticket?"
        message={confirmDelete ? `“${confirmDelete.title}” will be removed from this board. Its branch, worktrees, sessions, previews, and pull requests remain.` : ''}
        confirmLabel="Delete ticket"
        onConfirm={() => { if (confirmDelete) void run(() => api.deleteTicket(confirmDelete.id)); }}
        onClose={() => setConfirmDelete(null)}
      />
    </div>
  );
}

function TicketCard({ ticket, jobs, scopes, onEdit, onStart, onDelete, onStatus, onMove, onDragStart }: {
  ticket: TicketView;
  jobs: StatusView['jobs'];
  scopes: ProjectView['scopes'];
  onEdit: () => void;
  onStart: () => void;
  onDelete: () => void;
  onStatus: (status: string) => void;
  onMove: (direction: number) => void;
  onDragStart: () => void;
}) {
  const job = jobs.find((candidate) => candidate.ticketId === ticket.id && candidate.state !== 'succeeded');
  const scopeLabel = ticket.scopeDescription?.startsWith('Legacy scope:') ? ticket.scopeDescription : ticket.scopes?.join(', ') || (ticket.scopes ? 'Workspace-wide' : scopes.find((candidate) => candidate.id === ticket.scope)?.label ?? ticket.scope);
  const runState = ticket.run?.state;
  const active = runState === 'running' || runState === 'starting' || runState === 'interrupting';
  return (
    <article className="card" draggable onDragStart={onDragStart} data-ticket-id={ticket.id}>
      <div className="meta">
        <span className="scope-label">{scopeLabel}</span>
        <span className="grow" />
        <button aria-label="Move up" onClick={() => onMove(-1)}>↑</button>
        <button aria-label="Move down" onClick={() => onMove(1)}>↓</button>
        <button onClick={onEdit}>Edit</button>
      </div>
      <h4>{ticket.title}</h4>
      {ticket.description ? <p className="notes">{ticket.description}</p> : <p className="notes empty">No notes yet.</p>}
      <div className="branch"><code>{ticket.branch}</code></div>
      <div className="meta">
        {ticket.run ? (
          <Chip tone={stateTone(runState ?? 'stopped')} pulse={active}>
            {runState === 'running' ? `${ticket.run.agent} working` : runState === 'ready' ? 'Session ready' : runState === 'finished' ? 'Finished' : runState === 'interrupting' ? 'Interrupting…' : runState === 'starting' ? 'Starting' : runState === 'failed' ? 'Needs attention' : runState}
          </Chip>
        ) : null}
        {job ? <span>{job.phase ?? job.kind} · {job.progress}%</span> : null}
        {ticket.previewStatus ? <span>preview: {ticket.previewStatus}</span> : null}
      </div>
      {job ? <div className="progress"><div style={{ transform: `scaleX(${Math.max(0, Math.min(100, job.progress)) / 100})` }} /></div> : null}
      {ticket.run?.error ? <p className="error">{ticket.run.error}</p> : null}
      <div className="links">
        {ticket.previewUrl ? <a href={ticket.previewUrl} target="_blank" rel="noreferrer">Open preview</a> : null}
        {ticket.pullRequests.map((pull) => (
          <a key={`${pull.role}-${pull.number}`} href={pull.url} target="_blank" rel="noreferrer">{pull.role} #{pull.number}</a>
        ))}
        {ticket.artifacts.map((artifact) => (
          <a key={artifact.file} className={artifact.kind === 'manual' ? 'manual' : ''} href={artifact.url} target="_blank" rel="noreferrer">{artifact.label}</a>
        ))}
        {ticket.run ? <a href={ticket.run.logUrl} target="_blank" rel="noreferrer">Run log</a> : null}
      </div>
      <div className="actions">
        {!ticket.run ? <button className="primary" onClick={onStart}>Start agent</button> : null}
        {runState === 'running' || runState === 'starting' ? (
          <button onClick={() => void api.handoffTicket(ticket.id).then((result) => {
            if (result.deepLink) window.location.href = result.deepLink;
          })}>Take over</button>
        ) : null}
        {ticket.run && ticket.run.sessionId && (runState === 'ready' || runState === 'finished') ? (
          ticket.run.deepLink
            ? <a className="chip-link" href={ticket.run.deepLink}><button>Open session</button></a>
            : <button onClick={() => void api.handoffTicket(ticket.id)}>Open session</button>
        ) : null}
        <select style={{ width: 'auto' }} value={ticket.status} onChange={(event) => onStatus(event.target.value)} aria-label={`Status for ${ticket.title}`}>
          {COLUMNS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <button className="danger" onClick={onDelete}>Delete</button>
      </div>
    </article>
  );
}

function TicketDialog({ project, ticket, onClose, run }: {
  project: ProjectView;
  ticket: TicketView | null;
  onClose: () => void;
  run: (action: () => Promise<unknown>) => Promise<boolean>;
}) {
  const [title, setTitle] = useState(ticket?.title ?? '');
  const [description, setDescription] = useState(ticket?.description ?? '');
  const [scopes, setScopes] = useState(() => ticketServiceScopes(ticket ?? {}, project.services));
  const [scopesTouched, setScopesTouched] = useState(false);
  const scopeIds = [...new Set([...project.services.map((service) => service.id), ...(ticket?.scopes ?? [])])];
  const [branch, setBranch] = useState(ticket?.branch ?? '');
  const [branchTouched, setBranchTouched] = useState(Boolean(ticket));
  const [additions, setAdditions] = useState(ticket?.additions ?? '');
  const slug = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 54).replace(/-+$/g, '') || 'ticket';
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-body">
          <h3>{ticket ? 'Edit ticket' : 'New ticket'}</h3>
          <label>Title
            <input value={title} onChange={(event) => {
              setTitle(event.target.value);
              if (!branchTouched) setBranch(`${project.branchPrefix}/${slug(event.target.value)}`);
            }} autoFocus />
          </label>
          <label>Notes
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What should the agent do? Include context, constraints, and links." />
          </label>
          <div className="row">
            <fieldset className="ticket-scopes">
              <legend>Scope</legend>
              <p className="muted">Select affected services. Leave empty for workspace-wide work.</p>
              <div className="scope-options">
                {scopeIds.map((id) => <label key={id}>
                  <input type="checkbox" checked={scopes.includes(id)} onChange={(event) => { setScopesTouched(true); setScopes((selected) => event.target.checked ? [...selected, id] : selected.filter((value) => value !== id)); }} />
                  <span>{id}{!project.services.some((service) => service.id === id) && ' (unavailable)'}</span>
                </label>)}
              </div>
              {!project.services.length && <p className="muted">No services configured in gantry.yaml.</p>}
              {ticket && ticket.scopeDescription?.startsWith('Legacy scope:') && <p className="muted">Legacy scope: {ticket.scope}. Select services to replace it.</p>}
            </fieldset>
            <label>Branch
              <input value={branch} onChange={(event) => { setBranch(event.target.value); setBranchTouched(true); }} />
            </label>
          </div>
          <label>Extra prompt notes for this ticket (optional)
            <textarea style={{ minHeight: 60 }} value={additions} onChange={(event) => setAdditions(event.target.value)} />
          </label>
          <div className="actions">
            <button onClick={onClose}>Cancel</button>
            <button className="primary" disabled={!title.trim()} onClick={() => {
              const scopeChanged = !ticket || scopesTouched;
              const input = { title, description, ...(scopeChanged ? { scopes } : {}), branch, additions: additions || null };
              void run(() => (ticket ? api.updateTicket(ticket.id, input) : api.createTicket(project.id, input))).then((ok) => { if (ok) onClose(); });
            }}>
              {ticket ? 'Save' : 'Create ticket'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StartDialog({ project, ticket, onClose, run, setNotice, refresh }: {
  project: ProjectView;
  ticket: TicketView;
  onClose: () => void;
  run: (action: () => Promise<unknown>) => Promise<boolean>;
  setNotice: (message: string) => void;
  refresh: () => Promise<void>;
}) {
  const [agentId, setAgentId] = useState(project.defaultAgent);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.ticketPrompt(ticket.id, agentId).then((result) => {
      if (!cancelled) { setPrompt(result.prompt); setLoaded(true); }
    }).catch((error) => { if (!cancelled) { setNotice((error as Error).message); setLoaded(true); } });
    return () => { cancelled = true; };
  }, [ticket.id, agentId, setNotice]);

  const agent = project.agents.find((candidate) => candidate.id === agentId);
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-body">
          <h3>Start “{ticket.title}”</h3>
          <div className="row">
            <label>Agent
              <select value={agentId} onChange={(event) => setAgentId(event.target.value)}>
                {project.agents.map((candidate) => (
                  <option key={candidate.id} value={candidate.id} disabled={!candidate.capabilities.available}>
                    {candidate.capabilities.label}{candidate.capabilities.available ? '' : ' (not installed)'}
                  </option>
                ))}
              </select>
            </label>
            <label>Branch <input value={ticket.branch} readOnly /></label>
          </div>
          {agent ? (
            <p className="cap-note">
              resume: {agent.capabilities.resumeMode} · takeover: {agent.capabilities.takeover ? 'yes' : 'no'} ·
              {agent.capabilities.notes.map((note) => ` ${note}`)}
            </p>
          ) : null}
          <label>Startup prompt (editable — the agent receives exactly this)
            {prompt === null ? <p className="cap-note">{loaded ? 'Could not render the prompt.' : 'Rendering…'}</p> : (
              <textarea style={{ minHeight: 220, font: '12px/1.5 ui-monospace, Menlo, monospace' }} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
            )}
          </label>
          <div className="actions">
            <button onClick={onClose}>Cancel</button>
            <button
              className="primary"
              disabled={!prompt}
              onClick={() => {
                void run(() => api.startTicket(ticket.id, { agentId, prompt: prompt ?? undefined })).then((ok) => { if (ok) { onClose(); void refresh(); } });
              }}
            >
              Start agent
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewsBoard({ project, previews, run }: { project: ProjectView; previews: StatusView['previews']; run: (action: () => Promise<unknown>) => Promise<boolean> }) {
  const [confirmArchive, setConfirmArchive] = useState<string | null>(null);
  const active = previews.filter((preview) => !preview.archived && !preview.retired);
  const archived = previews.filter((preview) => preview.archived);
  const merged = previews.filter((preview) => preview.retired);
  return (
    <div>
      <div className="previews">
        {active.map((preview) => <PreviewCard key={preview.id} preview={preview} project={project} run={run} onArchive={() => setConfirmArchive(preview.id)} />)}
      </div>
      {active.length === 0 ? <div className="empty-state">No previews yet. Start a ticket — its worktrees and preview appear here automatically.</div> : null}
      {archived.length ? <div className="section-title">Archived <span className="count">({archived.length})</span></div> : null}
      {archived.map((preview) => <PreviewCard key={preview.id} preview={preview} project={project} run={run} />)}
      {merged.length ? <div className="section-title">Merged <span className="count">({merged.length})</span></div> : null}
      {merged.map((preview) => <PreviewCard key={preview.id} preview={preview} project={project} run={run} />)}
      <ConfirmDialog
        open={confirmArchive !== null}
        title="Archive preview?"
        message="Services stop and the preview moves to Archived. Worktrees, branches, and files remain; restore brings it back."
        confirmLabel="Archive preview"
        onConfirm={() => { if (confirmArchive) void run(() => api.previewAction(confirmArchive, 'archive', { confirm: true })); }}
        onClose={() => setConfirmArchive(null)}
      />
    </div>
  );
}

function PreviewCard({ preview, project, run, onArchive }: {
  preview: StatusView['previews'][number];
  project: ProjectView;
  run: (action: () => Promise<unknown>) => Promise<boolean>;
  onArchive?: () => void;
}) {
  const inactive = preview.paused || preview.archived || preview.retired || preview.removed;
  return (
    <article className="card" aria-label={preview.branch}>
      <div className="meta">
        <h4 style={{ margin: 0 }}>{preview.isPrimary ? 'Main workspace' : preview.branch}</h4>
        <Chip tone={preview.status === 'Running' ? 'good' : preview.status === 'Needs attention' ? 'bad' : 'muted'}>{preview.status}</Chip>
        <span className="grow" />
        <span className="cap-note">{project.environments.find((env) => env.id === (preview.environment ?? project.environments.find((env) => env.default)?.id))?.label ?? ''}</span>
      </div>
      <div>
        {preview.services.map((service) => (
          <div key={service.id} className="service-line">
            <span className="name">{service.id}</span>
            <Chip tone={stateTone(service.state)} pulse={service.state === 'starting' || service.state === 'installing'}>{service.state}</Chip>
            {service.port ? <code>:{service.port}</code> : null}
            {service.error ? <span className="cap-note" style={{ color: 'var(--bad)' }}>{service.error}</span> : null}
            {service.openLink && service.state === 'ready' ? <a href={service.openLink} target="_blank" rel="noreferrer">Open</a> : null}
            {service.logUrl ? <a href={service.logUrl} target="_blank" rel="noreferrer">Logs</a> : null}
          </div>
        ))}
      </div>
      <details>
        <summary className="cap-note">Checkouts ({preview.checkouts.length})</summary>
        {preview.checkouts.map((checkout) => (
          <div key={checkout.repositoryId} className="checkout-line">
            {checkout.repositoryId}: <code>{checkout.path}</code>
            {checkout.isFallback ? ' · fallback to main checkout' : ''}
            {checkout.head ? ` @ ${checkout.head.slice(0, 8)}` : ''}
          </div>
        ))}
        {Object.entries(preview.evidence).map(([repositoryId, value]) => (
          <div key={repositoryId} className="checkout-line">{repositoryId}: {value.evidence}{value.url ? <> · <a href={value.url}>#{value.number}</a></> : null}</div>
        ))}
      </details>
      {!inactive && project.environments.length > 1 ? (
        <div className="env-row">
          <span>Environment:</span>
          {project.environments.map((env) => (
            <button key={env.id} onClick={() => void run(() => api.previewAction(preview.id, 'environment', { environmentId: env.id }))}>
              {env.id === (preview.environment ?? project.environments.find((candidate) => candidate.default)?.id) ? `✓ ${env.label}` : env.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="actions">
        {!inactive && preview.services.some((service) => service.openLink && service.state === 'ready') ? (
          <a href={preview.services.find((service) => service.openLink && service.state === 'ready')!.openLink!} target="_blank" rel="noreferrer"><button>Open preview</button></a>
        ) : null}
        {!inactive ? (
          <>
            <button onClick={() => void run(() => api.previewAction(preview.id, preview.paused ? 'resume' : 'pause'))}>{preview.paused ? 'Resume' : 'Pause'}</button>
            <button onClick={() => void run(() => api.previewAction(preview.id, 'restart'))}>Restart</button>
          </>
        ) : (
          <button onClick={() => void run(() => api.previewAction(preview.id, 'restore'))}>Restore</button>
        )}
        {!inactive && !preview.isPrimary && onArchive ? <button className="danger" onClick={onArchive}>Archive</button> : null}
      </div>
    </article>
  );
}

function PullsBoard({ project, pulls, run }: { project: ProjectView; pulls: StatusView['pulls']; run: (action: () => Promise<unknown>) => Promise<boolean> }) {
  void run; void project;
  if (!pulls.length) {
    return (
      <div className="empty-state">
        No open pull requests. Connect the GitHub CLI once (<code>gh auth login</code>) and use “Sync remote” on the Previews tab.
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {pulls.map((group) => (
        <article key={group.id} className="card">
          <div className="meta">
            <h4 style={{ margin: 0 }}><code>{group.branch}</code></h4>
            <Chip tone={group.ready ? 'good' : 'warn'}>{group.ready ? 'Ready' : group.blockers.join(' · ') || 'Blocked'}</Chip>
            <span className="grow" />
            {group.previewUrl ? <a href={group.previewUrl} target="_blank" rel="noreferrer">Open preview</a> : null}
          </div>
          <div className="links">
            {Object.entries(group.pulls).map(([repositoryId, pull]) => {
              const reviewLink = prLensLink(pull.url);
              return (
                <div key={repositoryId}>
                  <a href={pull.url} target="_blank" rel="noreferrer">{repositoryId} #{pull.number} — {pull.title}</a>
                  {reviewLink ? <a href={reviewLink} style={{ marginLeft: 16 }} title="Requires the PR Lens desktop app">Open in PR Lens</a> : null}
                </div>
              );
            })}
          </div>
        </article>
      ))}
    </div>
  );
}
