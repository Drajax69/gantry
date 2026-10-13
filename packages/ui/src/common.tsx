import type { ReactNode } from 'react';

export function Chip({ tone, children, pulse }: { tone: 'good' | 'warn' | 'bad' | 'live' | 'muted'; children: ReactNode; pulse?: boolean }) {
  return (
    <span className={`chip ${tone} ${pulse ? 'pulse' : ''}`}>{children}</span>
  );
}

export function stateTone(state: string): 'good' | 'warn' | 'bad' | 'live' | 'muted' {
  if (state === 'ready' || state === 'finished') return 'good';
  if (state === 'running' || state === 'starting' || state === 'installing') return 'live';
  if (state === 'interrupting') return 'warn';
  if (state === 'failed') return 'bad';
  return 'muted';
}

export function ConfirmDialog({ open, title, message, confirmLabel, onConfirm, onClose }: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-body">
          <h3>{title}</h3>
          <p>{message}</p>
          <div className="actions">
            <button onClick={onClose}>Cancel</button>
            <button className="danger" onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</button>
  </div>
        </div>
      </div>
    </div>
  );
}
