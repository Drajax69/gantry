/**
 * Agent adapter capability model — the serializable shape shared by the
 * server (which implements adapters) and the UI (which renders them).
 *
 * Anything an adapter cannot do is reported explicitly instead of being
 * silently unavailable.
 */

export type ResumeMode = 'deeplink' | 'terminal' | 'unsupported';
export type InterruptMode = 'process-group' | 'process' | 'unsupported';

export interface AgentCapabilities {
  id: string;
  label: string;
  /** Binary found on this machine (PATH, known install location, or config override). */
  available: boolean;
  /** How it was found: "config", "path", or a well-known install path. */
  discoveredVia: string | null;
  version: string | null;
  resumeMode: ResumeMode;
  /** Can Gantry interrupt a background run safely mid-turn? */
  takeover: boolean;
  interruptMode: InterruptMode;
  /** Deep-link scheme for opening a session natively, e.g. "codex://threads". */
  deepLinkScheme: string | null;
  /** Structured session events streamed to the run log. */
  streaming: boolean;
  notes: string[];
}

export interface AgentDiscovery {
  capabilities: AgentCapabilities;
  error: string | null;
}

/** Static description used when no better discovery is possible. */
export function unavailableCapabilities(id: string, label: string, notes: string[] = []): AgentCapabilities {
  return {
    id,
    label,
    available: false,
    discoveredVia: null,
    version: null,
    resumeMode: 'unsupported',
    takeover: false,
    interruptMode: 'unsupported',
    deepLinkScheme: null,
    streaming: false,
    notes,
  };
}
