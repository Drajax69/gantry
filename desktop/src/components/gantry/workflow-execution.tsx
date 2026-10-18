'use client';
import { useEffect, useState } from 'react';
import { PlayIcon, PauseIcon, RotateCcwIcon, MessageSquareIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { TicketView } from '@/lib/client/gantry';
import type { Execution } from '@/lib/server/workflow-state';

export function ExecutionControls({ ticket, selected, refresh }: { ticket: TicketView; selected: string; refresh: () => Promise<unknown> }) {
  const [run, setRun] = useState<Execution | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reply, setReply] = useState('');
  useEffect(() => {
    let live = true;
    const load = () =>
      fetch(`/api/workflow-execution?ticketId=${encodeURIComponent(ticket.id)}`)
        .then(async (r) => {
          if (!r.ok) throw new Error('Could not load workflow execution.');
          return r.json();
        })
        .then((data) => {
          if (live) setRun(data);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    void load();
    const timer = setInterval(load, 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [ticket.id]);
  async function action(action: string) {
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/workflow-execution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId: ticket.id, action, nodeId: selected, message: reply }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      if (action !== 'open') setRun(data);
      await refresh();
      setReply('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const attempts = run?.attempts.filter((a) => a.nodeId === selected) ?? [];
  const active = run?.state === 'running';
  return (
    <div className="space-y-3 border-y py-4" aria-label="Workflow execution">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto text-sm font-medium">{run ? `Automation · ${run.state}` : 'Run the graph automatically'}</span>
        {!run ? (
          <Button size="sm" disabled={busy || ticket.status !== 'in_progress'} onClick={() => void action('start')}>
            <PlayIcon />
            Start workflow
          </Button>
        ) : (
          <>
            {active ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void action('pause')}>
                <PauseIcon />
                Pause
              </Button>
            ) : (
              run.state !== 'complete' && (
                <Button size="sm" disabled={busy || ticket.status !== 'in_progress'} onClick={() => void action('resume')}>
                  <PlayIcon />
                  Resume
                </Button>
              )
            )}
            {!active && selected && (
              <Button size="sm" variant="outline" disabled={busy || ticket.status !== 'in_progress'} onClick={() => void action('retry')}>
                <RotateCcwIcon />
                Retry from this step
              </Button>
            )}
            {attempts.at(-1)?.sessionId && attempts.at(-1)?.providerKind !== 'openai' && (
              <Button size="sm" variant="ghost" disabled={busy || active} onClick={() => void action('open')}>
                <MessageSquareIcon />
                Open stage chat
              </Button>
            )}
          </>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {run?.message ||
          'Each stage gets its own agent session and handovers. Up to ten tickets execute at once; stages within a ticket run sequentially to protect its worktrees.'}
      </p>
      {!run && ticket.conversation && (
        <Button size="sm" variant="outline" disabled={busy || ticket.status !== 'in_progress'} onClick={() => void action('handoff')}>
          I stopped the existing agent · Start after handoff
        </Button>
      )}
      {run?.steps[selected] === 'waiting' && (
        <div className="space-y-2">
          <Textarea
            aria-label="Workflow reply"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Answer the stage’s question or explain what changed…"
          />
          <Button size="sm" disabled={busy || !reply.trim()} onClick={() => void action('confirm')}>
            Reply and continue
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {attempts.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm">
            Stage history · {attempts.length} attempt{attempts.length === 1 ? '' : 's'}
          </summary>
          <div className="mt-3 space-y-4">
            {[...attempts].reverse().map((a, i) => (
              <div key={a.id} className="space-y-2">
                <p className="text-xs font-medium">
                  Attempt {attempts.length - i} · {a.state} · {a.model || a.providerKind}
                </p>
                <p className="whitespace-pre-wrap text-sm">{a.summary}</p>
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs">
                  {a.output || 'Waiting for agent output…'}
                </pre>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
