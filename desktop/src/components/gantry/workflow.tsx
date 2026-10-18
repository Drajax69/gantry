'use client';
import { useEffect, useRef, useState } from 'react';
import { GitBranchIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { gantry, type Workflow, type WorkflowRun, type TicketView, type ProjectView } from '@/lib/client/gantry';
import { WorkspacePromptDialog } from './workspace-prompt-dialog';

const stateLabel = { pending: 'Not started', running: 'In progress', waiting: 'Waiting on you', done: 'Complete', failed: 'Failed' };
export function graphSummary(run?: WorkflowRun | null) {
  if (!run) return null;
  const ready = run.graph.nodes.filter((n) => run.states[n.id]?.state === 'pending' && n.dependsOn.every((id) => run.states[id]?.state === 'done'));
  const active = run.graph.nodes.filter((n) => ['running', 'waiting', 'failed'].includes(run.states[n.id]?.state));
  const waiting = active.some((n) => run.states[n.id]?.state === 'waiting') || ready.some((n) => n.kind === 'human');
  const current = waiting
    ? run.graph.nodes.filter((n) => run.states[n.id]?.state === 'waiting' || (n.kind === 'human' && ready.some((r) => r.id === n.id)))
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
  const levels = new Map<string, number>();
  for (let pass = 0; pass < graph.nodes.length; pass++)
    for (const n of graph.nodes) {
      if (!levels.has(n.id) && n.dependsOn.every((id) => levels.has(id))) levels.set(n.id, Math.max(-1, ...n.dependsOn.map((id) => levels.get(id)!)) + 1);
    }
  const counts = new Map<number, number>();
  const positions = new Map(
    graph.nodes.map((n) => {
      const level = levels.get(n.id) ?? 0;
      const row = counts.get(level) ?? 0;
      counts.set(level, row + 1);
      return [n.id, { x: level * 220 + 16, y: row * 108 + 16 }];
    }),
  );
  const width = (Math.max(0, ...levels.values()) + 1) * 220 + 16;
  const height = Math.max(1, ...counts.values()) * 108 + 16;
  return (
    <div ref={viewport} className="max-h-96 overflow-auto rounded-lg border bg-muted/20 p-2" aria-label="Workflow graph">
      <div className="relative" style={{ width, height }}>
        <svg aria-hidden="true" className="absolute inset-0 text-muted-foreground" width={width} height={height}>
          {graph.nodes.flatMap((n) =>
            n.dependsOn.map((id) => {
              const a = positions.get(id);
              const b = positions.get(n.id);
              return a && b ? (
                <path
                  key={`${id}-${n.id}`}
                  d={`M ${a.x + 188} ${a.y + 38} C ${a.x + 208} ${a.y + 38}, ${b.x - 20} ${b.y + 38}, ${b.x} ${b.y + 38} l -6 -4 m 6 4 l -6 4`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
              ) : null;
            }),
          )}
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

function GraphEditor({
  initial,
  run,
  onSave,
  onCancel,
}: {
  initial: Workflow;
  run?: WorkflowRun | null;
  onSave: (graph: Workflow, revision: number) => Promise<void>;
  onCancel: () => void;
}) {
  const [graph, setGraph] = useState<Workflow>(() => structuredClone(initial));
  const [revision] = useState(run?.revision ?? -1);
  const [selected, setSelected] = useState(initial.nodes[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const node = graph.nodes.find((n) => n.id === selected);
  const locked = !!run && run.states[selected]?.state !== undefined && run.states[selected]?.state !== 'pending';
  const update = (values: Partial<Workflow['nodes'][number]>) =>
    setGraph((g) => ({ nodes: g.nodes.map((n) => (n.id === selected ? { ...n, ...values } : n)) }));
  return (
    <div className="space-y-4">
      <Graph graph={graph} run={run} selected={selected} onSelect={setSelected} />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant="outline"
          disabled={busy || graph.nodes.length >= 50}
          onClick={() => {
            const id = `step-${crypto.randomUUID().slice(0, 8)}`;
            setGraph((g) => ({ nodes: [...g.nodes, { id, label: 'New step', kind: 'agent', instructions: '', dependsOn: selected ? [selected] : [] }] }));
            setSelected(id);
          }}
        >
          <PlusIcon />
          Add step
        </Button>
        <span className="text-xs text-muted-foreground">Steps with the same dependencies can run in parallel.</span>
      </div>
      {node && (
        <fieldset disabled={locked || busy} className="space-y-3 rounded-lg border p-4">
          <legend className="px-1 text-sm font-medium">{locked ? 'Started step · read only' : 'Edit selected step'}</legend>
          <label className="block space-y-1 text-sm">
            Step name
            <Input value={node.label} maxLength={100} onChange={(e) => update({ label: e.target.value })} />
          </label>
          <label className="flex items-center gap-3 text-sm">
            Owner
            <select
              aria-label="Owner"
              className="rounded-md border bg-background p-2"
              value={node.kind}
              onChange={(e) => update({ kind: e.target.value as 'agent' | 'human' })}
            >
              <option value="agent">Agent</option>
              <option value="human">User decision</option>
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            Instructions
            <Textarea value={node.instructions} maxLength={10000} onChange={(e) => update({ instructions: e.target.value })} />
          </label>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm">Start after</legend>
            <div className="flex flex-wrap gap-3">
              {graph.nodes
                .filter((n) => n.id !== node.id)
                .map((n) => (
                  <label key={n.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={node.dependsOn.includes(n.id)}
                      onChange={(e) => update({ dependsOn: e.target.checked ? [...node.dependsOn, n.id] : node.dependsOn.filter((id) => id !== n.id) })}
                    />
                    {n.label}
                  </label>
                ))}
            </div>
            <p className="text-xs text-muted-foreground">Leave empty to start here. All selected steps must finish first.</p>
          </fieldset>
          <Button
            size="sm"
            variant="ghost"
            disabled={graph.nodes.length === 1 || !!run?.graph.nodes.some((n) => n.dependsOn.includes(node.id) && run.states[n.id]?.state !== 'pending')}
            onClick={() => {
              setGraph((g) => ({
                nodes: g.nodes.filter((n) => n.id !== node.id).map((n) => ({ ...n, dependsOn: n.dependsOn.filter((id) => id !== node.id) })),
              }));
              setSelected(graph.nodes.find((n) => n.id !== node.id)!.id);
            }}
          >
            <Trash2Icon />
            Remove step
          </Button>
        </fieldset>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          disabled={busy || graph.nodes.some((n) => !n.label.trim())}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await onSave(graph, revision);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Saving…' : 'Save graph'}
        </Button>
      </div>
    </div>
  );
}

export function WorkspaceGraphDialog({ project, onClose }: { project: ProjectView; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [graph, setGraph] = useState<Workflow | null>(null);
  const [error, setError] = useState('');
  const [instructions, setInstructions] = useState(false);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const dialog = ref.current!;
    let live = true;
    dialog.showModal();
    gantry
      .workspaceWorkflow(project.id)
      .then((g) => {
        if (live) setGraph(g);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
      dialog.close();
      previous?.focus();
    };
  }, [project.id]);
  return (
    <dialog
      ref={ref}
      aria-labelledby="workflow-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="fixed inset-0 m-auto max-h-[90dvh] w-[min(64rem,calc(100vw-32px))] max-w-none overflow-auto rounded-xl border bg-background p-6 text-foreground shadow-xl backdrop:bg-black/40"
    >
      <h2 id="workflow-title" className="text-lg font-semibold">
        Workspace graph · {project.name}
      </h2>
      <p className="mt-2 mb-4 text-sm text-muted-foreground">New tickets get their own copy of this path. Changes here affect future tickets only.</p>
      {graph ? (
        <GraphEditor
          initial={graph}
          onCancel={onClose}
          onSave={async (g) => {
            await gantry.saveWorkspaceWorkflow(project.id, g);
            onClose();
          }}
        />
      ) : (
        <>
          <p role={error ? 'alert' : 'status'}>{error || 'Loading graph…'}</p>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </>
      )}
      <Button className="mt-4" size="sm" variant="ghost" onClick={() => setInstructions(true)}>
        Shared starting instructions
      </Button>
      {instructions && <WorkspacePromptDialog project={project} onClose={() => setInstructions(false)} />}
    </dialog>
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
  const ready = node?.dependsOn.every((id) => run?.states[id]?.state === 'done');
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
        <Button size="sm" variant="outline" disabled={ticket.status === 'done'} onClick={() => setEditing(!editing)}>
          {editing ? 'View progress' : 'Edit graph'}
        </Button>
      </div>
      <p role="status" className={`text-sm ${graphSummary(run)?.waiting ? 'font-medium text-amber-700 dark:text-amber-300' : 'text-muted-foreground'}`}>
        {graphSummary(run)?.text}
      </p>
      {editing ? (
        <GraphEditor
          initial={run.graph}
          run={run}
          onCancel={() => setEditing(false)}
          onSave={async (graph, revision) => {
            await gantry.saveTicketWorkflow(ticket.id, graph, revision);
            await refresh();
            setEditing(false);
          }}
        />
      ) : (
        <>
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
              {ready && state?.state !== 'done' && ticket.status !== 'done' && (
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
