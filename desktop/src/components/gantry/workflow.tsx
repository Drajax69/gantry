'use client';
import { useEffect, useRef, useState } from 'react';
import { GitBranchIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { gantry, type Workflow, type WorkflowRun, type TicketView } from '@/lib/client/gantry';
import { ExecutionControls } from './workflow-execution';
import { nodePositions } from '@/lib/client/workflow-graph';
import { WorkflowCanvas } from './workflow-canvas';

const stateLabel = { pending: 'Not started', running: 'In progress', waiting: 'Waiting on you', done: 'Complete', failed: 'Failed' };
export function graphSummary(run?: WorkflowRun | null, execution?: TicketView['execution']) {
  if (!run) return null;
  if (execution?.state === 'complete') return { waiting: false, text: 'Graph complete' };
  if (execution && ['waiting', 'paused'].includes(execution.state)) return { waiting: true, text: execution.message || 'Waiting on you' };
  if (!run.graph.nodes.length) return { waiting: false, text: 'No nodes yet' };
  const ready = run.graph.nodes.filter((n) => run.states[n.id]?.state === 'pending' && n.dependsOn.every((id) => run.states[id]?.state === 'done'));
  const active = run.graph.nodes.filter((n) => ['running', 'waiting', 'failed'].includes(run.states[n.id]?.state));
  const waiting = active.some((n) => ['waiting', 'failed'].includes(run.states[n.id]?.state)) || ready.some((n) => n.kind === 'human');
  const current = waiting
    ? run.graph.nodes.filter((n) => ['waiting', 'failed'].includes(run.states[n.id]?.state) || (n.kind === 'human' && ready.some((r) => r.id === n.id)))
    : active.length
      ? active
      : ready;
  return {
    waiting,
    text: run.graph.nodes.every((n) => run.states[n.id]?.state === 'done')
      ? 'Graph complete'
      : `${waiting ? 'Waiting on you · ' : active.length ? '' : 'Next · '}${current.map((n) => n.label).join(', ')}`,
  };
}

/** Layers make forks and joins visible; arbitrary labels never become SVG markup. */
function Graph({ graph, run, selected, onSelect }: { graph: Workflow; run?: WorkflowRun | null; selected: string; onSelect: (id: string) => void }) {
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = viewport.current;
    if (!container) return;
    const reveal = () => {
      const button = container.querySelector<HTMLElement>(`[data-step-id="${selected}"]`);
      if (!button) return;
      const left = button.offsetLeft;
      const top = button.offsetTop;
      if (left < container.scrollLeft || left + button.offsetWidth > container.scrollLeft + container.clientWidth)
        container.scrollLeft = Math.max(0, left - 16);
      if (top < container.scrollTop || top + button.offsetHeight > container.scrollTop + container.clientHeight) container.scrollTop = Math.max(0, top - 16);
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(container);
    return () => observer.disconnect();
  }, [selected, graph.nodes.length]);
  const positions = new Map(Object.entries(nodePositions(graph)));
  const edges = graph.edges ?? graph.nodes.flatMap((n) => n.dependsOn.map((source) => ({ id: `${source}-${n.id}`, source, target: n.id, label: '' })));
  const width = Math.max(300, ...[...positions.values()].map((p) => p.x + 240));
  const height = Math.max(150, ...[...positions.values()].map((p) => p.y + 130));
  return (
    <div ref={viewport} className="max-h-96 overflow-auto rounded-lg border bg-muted/20 p-2" aria-label="Workflow graph">
      <div className="relative" style={{ width, height }}>
        <svg aria-hidden="true" className="absolute inset-0 text-muted-foreground" width={width} height={height}>
          {edges.map((edge) => {
            const a = positions.get(edge.source),
              b = positions.get(edge.target);
            if (!a || !b) return null;
            const sx = a.x + 188,
              sy = a.y + 38,
              tx = b.x,
              ty = b.y + 38;
            return (
              <g key={edge.id}>
                <title>{edge.label}</title>
                <path
                  d={
                    tx > sx
                      ? `M ${sx} ${sy} C ${sx + 60} ${sy}, ${tx - 60} ${ty}, ${tx} ${ty}`
                      : `M ${sx} ${sy} C ${sx + 80} ${sy + 100}, ${tx - 80} ${ty + 100}, ${tx} ${ty}`
                  }
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
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
              className={`absolute flex h-[76px] w-[188px] flex-col justify-center rounded-lg border bg-background px-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-ring ${selected === n.id ? 'border-primary ring-1 ring-primary' : ''}`}
              style={{ left: pos.x, top: pos.y }}
            >
              <span className="w-full truncate font-medium">{n.label || 'Untitled step'}</span>
              <span
                className={`mt-1 text-xs ${state === 'waiting' || readyHuman ? 'font-semibold text-amber-700 dark:text-amber-300' : 'text-muted-foreground'}`}
              >
                {readyHuman ? 'Waiting on you' : state ? stateLabel[state] : n.kind === 'human' ? 'User decision' : 'Agent step'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function TicketWorkflow({ ticket, refresh }: { ticket: TicketView; refresh: () => Promise<unknown> }) {
  const run = ticket.workflow;
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState(run?.graph.nodes.find((n) => run.states[n.id]?.state !== 'done')?.id ?? '');
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
        <Button size="sm" variant="outline" disabled={ticket.status === 'done' || !!ticket.execution} onClick={() => setEditing(!editing)}>
          {editing ? 'View progress' : 'Edit graph'}
        </Button>
      </div>
      <p role="status" className={`text-sm ${graphSummary(run, ticket.execution)?.waiting ? 'font-medium text-amber-700 dark:text-amber-300' : 'text-muted-foreground'}`}>
        {graphSummary(run, ticket.execution)?.text}
      </p>
      <ExecutionControls ticket={ticket} selected={selected} refresh={refresh} />
      {editing ? (
        <WorkflowCanvas
          initial={run.graph}
          onCancel={() => setEditing(false)}
          onSave={async (graph) => {
            await gantry.saveTicketWorkflow(ticket.id, graph, run.revision);
            await refresh();
            setEditing(false);
          }}
        />
      ) : (
        <>
          <Graph
            graph={run.graph}
            selected={selected}
            onSelect={(id) => {
              setSelected(id);
              setMessage('');
              setError('');
            }}
          />
          {node && (
            <div className="space-y-3 rounded-lg border p-4">
              <h4 className="font-medium">{node.label}</h4>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{node.instructions}</p>
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
                <>
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
                </>
              )}
            </div>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
