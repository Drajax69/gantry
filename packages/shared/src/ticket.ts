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
  /** Legacy category retained for older clients. */
  scope: string;
  scopes: string[];
  scopeDescription?: string;
  branch: string;
  position: number;
  createdAt: string;
  updatedAt: string;
  workflow?: import('./workflow.js').WorkflowRun | null;
  additions: string | null;
  run: TicketRunView | null;
  previewUrl: string | null;
  previewStatus: string | null;
  pullRequests: { role: string; number: number; url: string; title: string }[];
  artifacts: { file: string; label: string; kind: string; url: string; size: number }[];
}

/** Resolve old categories without changing persisted tickets on read. */
export function ticketServiceScopes(
  ticket: { scope?: string; scopes?: string[] | null },
  services: { id: string; repository: string }[] = [],
): string[] {
  if (ticket.scopes != null) return ticket.scopes;
  if (!ticket.scope || ticket.scope === 'both') return services.map((service) => service.id);
  return services
    .filter((service) => service.id === ticket.scope || service.repository === ticket.scope)
    .map((service) => service.id);
}

export function ticketScopeDescription(
  ticket: { scope?: string; scopes?: string[] | null },
  services: { id: string; repository: string }[] = [],
): string {
  const selected = ticketServiceScopes(ticket, services);
  if (selected.length) return selected.join(', ');
  if (ticket.scopes == null && ticket.scope && ticket.scope !== 'both') return `Legacy scope: ${ticket.scope}`;
  return 'No service scope selected (workspace-wide work)';
}
