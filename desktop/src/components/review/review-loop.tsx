'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { GitBranchIcon, Loader2Icon, RotateCcwIcon, XIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Graph } from '@/components/gantry/workflow';
import type { Execution } from '@/lib/server/workflow-state';
import type { WorkflowRun } from '@/lib/client/gantry';

export function ReviewLoop({ targetId, spaceId }: { targetId: string; spaceId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <GitBranchIcon />
        Review loop
      </Button>
      {open && <ReviewLoopDialog key={`${targetId}:${spaceId}`} targetId={targetId} spaceId={spaceId} onClose={() => setOpen(false)} />}
    </>
  );
}

function ReviewLoopDialog({ targetId, spaceId, onClose }: { targetId: string; spaceId?: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [run, setRun] = useState<Execution | null>(null);
  const [selected, setSelected] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  useEffect(() => {
    const before = document.activeElement as HTMLElement;
    const d = dialog.current!;
    d.showModal();
    return () => {
      d.close();
      before?.focus();
    };
  }, []);

  const load = useCallback(
    (signal?: AbortSignal) => {
      const params = new URLSearchParams({ targetId, ...(spaceId ? { spaceId } : {}) });
      return fetch(`/api/review-loop?${params}`, { signal })
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || 'Could not load the review graph.');
          return data as { run: Execution | null };
        })
        .then(({ run }) => {
          if (signal?.aborted) return;
          setRun(run);
          setSelected((current) =>
            run?.graph.nodes.some((n) => n.id === current)
              ? current
              : run?.graph.nodes.find((n) => /implement|build/i.test(n.label))?.id || run?.graph.nodes[0]?.id || '',
          );
          if (!run) setError('Start this ticket’s workflow from the ticket graph first.');
        })
        .catch((e: Error) => {
          if (!signal?.aborted) setError(e.message);
        })
        .finally(() => {
          if (!signal?.aborted) setLoading(false);
        });
    },
    [targetId, spaceId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function restart() {
    if (!run || !selected || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/review-loop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetId, spaceId, nodeId: selected, message: note, expectedUpdatedAt: run.updatedAt, confirm: true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not restart the workflow.');
      toast.success('Workflow restarted with PR review feedback.');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  const snapshot: WorkflowRun | null = run
    ? {
        graph: run.graph,
        revision: 0,
        states: Object.fromEntries(Object.entries(run.steps).map(([id, state]) => [id, { state, message: '' }])),
      }
    : null;
  const active = run?.state === 'running' || Object.values(run?.steps ?? {}).includes('running');
  const node = run?.graph.nodes.find((n) => n.id === selected);

  return (
    <dialog
      ref={dialog}
      aria-label="Restart graph from review"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      className="fixed inset-0 m-auto max-h-[90dvh] w-[min(64rem,calc(100vw-32px))] max-w-none overflow-auto rounded-xl border bg-background p-6 text-foreground shadow-xl backdrop:bg-black/35"
    >
      <div className="mb-4 flex items-center gap-3">
        <h2 className="flex-1 text-lg font-semibold">Restart graph from review</h2>
        <Button size="icon-sm" variant="ghost" aria-label="Close review loop" disabled={busy} onClick={onClose}>
          <XIcon />
        </Button>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Choose the stage to revisit. Gantry refreshes GitHub comments and includes file threads, general reviews, and local review discussion in the next
        stages.
      </p>
      {loading ? (
        <p role="status" className="flex items-center gap-2 text-sm">
          <Loader2Icon className="size-4 animate-spin" />
          Loading review graph…
        </p>
      ) : (
        run && <Graph graph={run.graph} run={snapshot} selected={selected} onSelect={setSelected} compact />
      )}
      {active && <p className="mt-3 text-sm">Pause the workflow in the ticket graph and wait for the current stage to stop, then reload here.</p>}
      <label className="mt-4 block space-y-2 text-sm">
        <span>Additional instructions (optional)</span>
        <Textarea
          aria-label="Review loop instructions"
          value={note}
          maxLength={4000}
          disabled={busy}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What should this correction focus on?"
        />
      </label>
      {node && (
        <p className="mt-3 text-sm">
          Restarting <strong>{node.label}</strong> resets it and its downstream stages. Previous attempts and PR links are retained.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <Button
          variant="outline"
          disabled={busy || loading}
          onClick={() => {
            setLoading(true);
            setError('');
            setRun(null);
            void load();
          }}
        >
          Reload graph
        </Button>
        <Button disabled={busy || loading || !node || active} onClick={() => void restart()}>
          {busy ? <Loader2Icon className="animate-spin" /> : <RotateCcwIcon />}Restart with review feedback
        </Button>
      </div>
    </dialog>
  );
}
