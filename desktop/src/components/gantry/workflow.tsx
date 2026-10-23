'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { CircleAlertIcon, CircleCheckIcon, CircleDotIcon, GitBranchIcon, Loader2Icon, MinusIcon, PlusIcon, MaximizeIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { gantry, type Workflow, type WorkflowRun, type TicketView } from '@/lib/client/gantry';
import { ExecutionControls } from './workflow-execution';
import { nodePositions } from '@/lib/client/workflow-graph';
import { WorkflowCanvas } from './workflow-canvas';
import { confirmGraphNavigation } from '@/lib/client/unsaved-graph';

const stateLabel = { pending: 'Not started', running: 'In progress', waiting: 'Waiting on you', done: 'Complete', failed: 'Failed' };
export type GraphPhase = 'complete' | 'waiting' | 'running' | 'next' | 'empty';

/** Execution owns the current stage, including correction loops and decisions. */
export function currentWorkflowStage(run?: WorkflowRun | null, execution?: TicketView['execution']) {
  const currentId = execution?.activeNodeId ?? execution?.decision?.nodeId;

  return run?.graph.nodes.find(n => n.id === currentId)?.id
    ?? run?.graph.nodes.find(n => ['running', 'waiting', 'failed'].includes(run.states[n.id]?.state))?.id
    ?? run?.graph.nodes.find(n => run.states[n.id]?.state === 'pending' && n.dependsOn.every(id => run.states[id]?.state === 'done'))?.id
    ?? run?.graph.nodes.at(-1)?.id
    ?? '';
}

/** Where a ticket's graph is: its phase, the stages that phase is about, and how many stages are done. */
export function graphSummary(run?: WorkflowRun | null, execution?: TicketView['execution']) {
  if (!run) return null;
  const total = run.graph.nodes.length;
  const done = run.graph.nodes.filter((n) => run.states[n.id]?.state === 'done').length;
  const result = (phase: GraphPhase, label: string, text = label) => ({ phase, label, text, waiting: phase === 'waiting', done, total });
  if (execution?.state === 'complete') return result('complete', 'Graph complete');
  if (execution && ['waiting', 'paused'].includes(execution.state)) return result('waiting', execution.message || 'Waiting on you');
  if (!total) return result('empty', 'No nodes yet');
  const ready = run.graph.nodes.filter((n) => run.states[n.id]?.state === 'pending' && n.dependsOn.every((id) => run.states[id]?.state === 'done'));
  const active = run.graph.nodes.filter((n) => ['running', 'waiting', 'failed'].includes(run.states[n.id]?.state));
  const waiting = active.some((n) => ['waiting', 'failed'].includes(run.states[n.id]?.state)) || ready.some((n) => n.kind === 'human');
  const current = waiting
    ? run.graph.nodes.filter((n) => ['waiting', 'failed'].includes(run.states[n.id]?.state) || (n.kind === 'human' && ready.some((r) => r.id === n.id)))
    : active.length
      ? active
      : ready;
  if (done === total) return result('complete', 'Graph complete');
  const label = current.map((n) => n.label).join(', ');
  return waiting ? result('waiting', label, `Waiting on you · ${label}`) : active.length ? result('running', label) : result('next', label, `Next · ${label}`);
}

const PHASE_STYLE: Record<GraphPhase, { icon: typeof CircleCheckIcon; title: string; className: string }> = {
  complete: { icon: CircleCheckIcon, title: 'Graph complete', className: 'border-emerald-600/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300' },
  waiting: { icon: CircleAlertIcon, title: 'Waiting on you', className: 'border-amber-600/40 bg-amber-500/15 text-amber-900 dark:text-amber-200' },
  running: { icon: Loader2Icon, title: 'Running', className: 'border-sky-600/30 bg-sky-500/10 text-sky-900 dark:text-sky-200' },
  next: { icon: CircleDotIcon, title: 'Up next', className: 'border-border bg-muted/50 text-foreground' },
  empty: { icon: CircleDotIcon, title: 'No stages', className: 'border-border bg-muted/50 text-muted-foreground' },
};

/** A ticket's graph phase as a card-sized block: what kind of state it is, which stage, and progress. */
export function GraphStatus({ run, execution }: { run?: WorkflowRun | null; execution?: TicketView['execution'] }) {
  const summary = graphSummary(run, execution);
  if (!summary) return null;
  const style = PHASE_STYLE[summary.phase];
  const Icon = style.icon;
  const detail = summary.phase === 'complete' ? '' : summary.label;
  return <span role="status" aria-label={`${style.title}${detail ? `: ${detail}` : ''}`} className={`flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-xs ${style.className}`}>
    <Icon aria-hidden="true" className={`mt-px size-3.5 shrink-0 ${summary.phase === 'running' ? 'animate-spin' : ''}`} />
    <span className="min-w-0 flex-1">
      <span className="block font-semibold">{style.title}</span>
      {detail && <span className="line-clamp-2 break-words opacity-90">{detail}</span>}
    </span>
    {summary.total > 0 && <span className="shrink-0 tabular-nums opacity-75" title={`${summary.done} of ${summary.total} stages done`}>{summary.done}/{summary.total}</span>}
  </span>;
}

/** Layers make forks and joins visible; arbitrary labels never become SVG markup. */
export function Graph({ graph, run, selected, onSelect, compact = false, current }: {
  graph: Workflow;
  run?: WorkflowRun | null;
  selected: string;
  onSelect: (id: string) => void;
  compact?: boolean;
  current?: string;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [fitView, setFitView] = useState(true);
  const arrow = useId().replaceAll(':', '');
  const layout = nodePositions(graph);
  // Legacy graphs have no authored positions. Wrap their dependency layers so
  // long paths remain legible instead of shrinking to a single tiny row.
  if (!graph.nodes.some(n => n.position)) {
    const columns = [...new Set(Object.values(layout).map(p => p.x))].sort((a, b) => a - b);
    const rowsPerBand = Math.max(1, ...columns.map(x => Object.values(layout).filter(p => p.x === x).length));
    for (const pos of Object.values(layout)) {
      const level = columns.indexOf(pos.x);
      const band = Math.floor(level / 3);
      const column = band % 2 ? 2 - level % 3 : level % 3;
      pos.x = 32 + column * 270;
      pos.y = 32 + band * rowsPerBand * 150 + Math.max(0, (pos.y - 100) / 190) * 150;
    }
  }
  const positions = new Map(Object.entries(layout));
  const edges = graph.edges ?? graph.nodes.flatMap((n) => n.dependsOn.map((source) => ({ id: `${source}-${n.id}`, source, target: n.id, label: '' })));
  const width = Math.max(300, ...[...positions.values()].map((p) => p.x + 240));
  const height = Math.max(150, ...[...positions.values()].map((p) => p.y + 130));
  useEffect(() => {
    const container = viewport.current;
    if (!container || !fitView) return;
    const fit = () => setZoom(Math.min(1, (container.clientWidth - 32) / width, (container.clientHeight - 32) / height));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    return () => observer.disconnect();
  }, [fitView, width, height]);
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border bg-muted/20">
      <div className="flex items-center gap-1 border-b bg-background px-3 py-2">
        <select aria-label="Selected workflow stage" className="mr-auto min-w-0 max-w-48 rounded-md border bg-background px-2 py-1 text-sm" value={selected} onChange={e => onSelect(e.target.value)}>{graph.nodes.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}</select>
        <Button size="icon-sm" variant="ghost" aria-label="Zoom out graph" onClick={() => { setFitView(false); setZoom(z => Math.max(.15, z - .15)); }}><MinusIcon /></Button>
        <span className="w-10 text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
        <Button size="icon-sm" variant="ghost" aria-label="Zoom in graph" onClick={() => { setFitView(false); setZoom(z => Math.min(2, z + .15)); }}><PlusIcon /></Button>
        <Button size="sm" variant="ghost" onClick={() => setFitView(true)}><MaximizeIcon />Fit</Button>
      </div>
      <div ref={viewport} className={`${compact ? 'h-[min(32dvh,280px)] min-h-48' : 'h-[min(38dvh,360px)] min-h-64 xl:h-[min(56dvh,620px)]'} overflow-auto p-4`} aria-label="Workflow graph">
      <div style={{ width: width * zoom, height: height * zoom }}>
      <div className="relative origin-top-left" style={{ width, height, transform: `scale(${zoom})` }}>
        <svg aria-hidden="true" className="absolute inset-0 text-muted-foreground" width={width} height={height}>
          <defs><marker id={arrow} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z" fill="currentColor" /></marker></defs>
          {edges.map((edge) => {
            const a = positions.get(edge.source),
              b = positions.get(edge.target);
            if (!a || !b) return null;
            const vertical = a.x === b.x;
            const direction = b.x < a.x ? -1 : 1;
            const sx = vertical ? a.x + 94 : a.x + (direction > 0 ? 188 : 0);
            const sy = vertical ? a.y + (b.y > a.y ? 76 : 0) : a.y + 38;
            const tx = vertical ? b.x + 94 : b.x + (direction > 0 ? 0 : 188);
            const ty = vertical ? b.y + (b.y > a.y ? 0 : 76) : b.y + 38;
            return (
              <g key={edge.id}>
                <title>{edge.label}</title>
                <path
                  d={vertical
                    ? `M ${sx} ${sy} C ${sx} ${(sy + ty) / 2}, ${tx} ${(sy + ty) / 2}, ${tx} ${ty}`
                    : `M ${sx} ${sy} C ${sx + direction * 45} ${sy}, ${tx - direction * 45} ${ty}, ${tx} ${ty}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  markerEnd={`url(#${arrow})`}
                />
              </g>
            );
          })}
        </svg>
        {graph.nodes.map((n) => {
          const pos = positions.get(n.id)!;
          const state = run?.states[n.id]?.state;
          const readyHuman = n.kind === 'human' && state === 'pending' && n.dependsOn.every((id) => run?.states[id]?.state === 'done');
          return (
            <button
              key={n.id}
              type="button"
              title={n.label}
              data-step-id={n.id}
              onClick={() => onSelect(n.id)}
              aria-pressed={selected === n.id}
              aria-current={current === n.id ? 'step' : undefined}
              className={`absolute flex h-[76px] w-[188px] flex-col justify-center rounded-lg border bg-background px-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-ring ${selected === n.id ? 'border-primary ring-1 ring-primary' : ''}`}
              style={{ left: pos.x, top: pos.y }}
            >
              <span className="w-full truncate font-medium">{n.label || 'Untitled step'}</span>
              <span
                className={`mt-1 text-xs ${state === 'waiting' || readyHuman ? 'font-semibold text-amber-700 dark:text-amber-300' : 'text-muted-foreground'}`}
              >
                {current === n.id && <span className="font-semibold text-primary">Current · </span>}
                {readyHuman ? 'Waiting on you' : state ? stateLabel[state] : n.kind === 'human' ? 'User decision' : 'Agent step'}
              </span>
            </button>
          );
        })}
      </div>
      </div>
      </div>
    </div>
  );
}

export function TicketWorkflow({ ticket, refresh }: { ticket: TicketView; refresh: () => Promise<unknown> }) {
  const run = ticket.workflow;
  const [editing, setEditing] = useState(false);
  const [selection, setSelected] = useState('');
  // Follow the current stage until the person chooses a stage to inspect.
  // Pending nodes may precede the active node after a correction loop.
  const selected = (run?.graph.nodes.some(n => n.id === selection) ? selection : undefined)
    ?? currentWorkflowStage(run, ticket.execution);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const node = run?.graph.nodes.find((n) => n.id === selected);
  const state = node && run?.states[node.id];
  const ready = run?.graph.edges !== undefined || node?.dependsOn.every((id) => run?.states[id]?.state === 'done');
  async function progress(next: 'running' | 'waiting' | 'done' | 'failed') {
    if (!node || !run) return;
    setBusy(true);
    setError('');
    try {
      await gantry.stepProgress(ticket.id, node.id, next, message, run.revision);
      setMessage('');
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  if (!run)
    return (
      <section className="space-y-3">
        <p className="text-sm text-muted-foreground">This older ticket has no graph snapshot.</p>
        <Button
          variant="outline"
          disabled={busy || ticket.status === 'done'}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              const graph = await gantry.workspaceWorkflow(ticket.projectId);
              await gantry.saveTicketWorkflow(ticket.id, graph, -1);
              await refresh();
              setSelected(graph.nodes[0]?.id ?? '');
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Copy workspace graph
        </Button>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </section>
    );
  return (
    <section aria-label="Ticket graph" className="space-y-3">
      <div className="flex items-center gap-2">
        <GitBranchIcon className="size-4" />
        <h3 className="flex-1 font-medium">Ticket graph</h3>
        <Button size="sm" variant="outline" disabled={ticket.status === 'done' || !!ticket.execution} onClick={() => { if (!editing || confirmGraphNavigation()) setEditing(!editing); }}>
          {editing ? 'View progress' : 'Edit graph'}
        </Button>
      </div>
      <p role="status" className={`text-sm ${graphSummary(run, ticket.execution)?.waiting ? 'font-medium text-amber-700 dark:text-amber-300' : 'text-muted-foreground'}`}>
        {graphSummary(run, ticket.execution)?.text}
      </p>
      {editing ? (
        <WorkflowCanvas
          initial={run.graph}
          templateProjectId={ticket.projectId}
          onCancel={() => setEditing(false)}
          onSave={async (graph) => {
            await gantry.saveTicketWorkflow(ticket.id, graph, run.revision);
            await refresh();
            setEditing(false);
          }}
        />
      ) : (
        <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Graph
            graph={run.graph}
            run={run}
            selected={selected}
            onSelect={(id) => {
              setSelected(id);
              setMessage('');
              setError('');
            }}
          />
          {node && (
            <div className="min-w-0 space-y-4 xl:max-h-[calc(56dvh+52px)] xl:overflow-y-auto xl:pr-2">
              <h4 className="font-medium">{node.label}</h4>
              <ExecutionControls ticket={ticket} selected={selected} refresh={refresh} onSelect={(id) => { setSelected(id); setMessage(''); setError(''); }} />
              <details className="border-b pb-4"><summary className="cursor-pointer text-sm font-medium">Stage instructions</summary><p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{node.instructions || 'No additional instructions.'}</p></details>
              {state?.message && <p className="whitespace-pre-wrap text-sm">{state.message}</p>}
              {!ready && (
                <p className="text-xs text-muted-foreground">
                  Waiting for:{' '}
                  {node.dependsOn
                    .filter((id) => run.states[id]?.state !== 'done')
                    .map((id) => run.graph.nodes.find((n) => n.id === id)?.label)
                    .join(', ')}
                </p>
              )}
              {!ticket.execution && ready && state?.state !== 'done' && ticket.status !== 'done' && (
                <details><summary className="cursor-pointer text-sm text-muted-foreground">Update progress manually</summary>
                  <label className="block space-y-1 text-sm">
                    Update or question
                    <Textarea
                      value={message}
                      maxLength={2000}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="What do you need, or what was verified?"
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {node.kind === 'agent' && (
                      <Button size="sm" variant="outline" disabled={busy || state?.state === 'running'} onClick={() => void progress('running')}>
                        Mark in progress
                      </Button>
                    )}
                    <Button size="sm" variant="outline" disabled={busy || !message.trim()} onClick={() => void progress('waiting')}>
                      Waiting on user
                    </Button>
                    <Button size="sm" disabled={busy} onClick={() => void progress('done')}>
                      {node.kind === 'human' ? 'Confirm and continue' : 'Mark complete'}
                    </Button>
                  </div>
                </details>
              )}
            </div>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
