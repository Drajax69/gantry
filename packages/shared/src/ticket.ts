/** Ticket domain types shared by server and UI. */

export const TICKET_STATUSES = ['backlog', 'in_progress', 'done'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** Chat/run state for a ticket's agent run, as exposed to the UI. */
export interface TicketRunView {
  id: string;
  agent: string;
  state: 'starting' | 'running' | 'ready' | 'finished' | 'failed' | 'interrupting';
  sessionId: string | null;
  deepLink: string | null;
  startedAt: string | null;
  endedAt: string | null;
  error: string | null;
  /** Live process verification, not just the recorded state. */
  processAlive: boolean;
}

export interface TicketView {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: TicketStatus;
  scope: string;
  branch: string;
  position: number;
  createdAt: string;
  updatedAt: string;
  additions: string | null;
  run: TicketRunView | null;
  previewUrl: string | null;
  previewStatus: string | null;
  pullRequests: { role: string; number: number; url: string; title: string }[];
  artifacts: { file: string; label: string; kind: string; url: string; size: number }[];
}
