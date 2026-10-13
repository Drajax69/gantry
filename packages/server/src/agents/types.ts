import type { AgentCapabilities } from '@gantry/shared';

/**
 * Agent adapter contract. Adding a new coding agent means implementing this
 * interface and registering it — no core ticket or preview logic changes.
 */

export interface SpawnSpec {
  argv: string[];
  cwd: string;
  /** Claim text used later to verify process ownership via ps. */
  claim: string;
}

export interface AgentStartContext {
  /** Directory the agent should treat as its workspace. */
  workspace: string;
  /** Fully rendered startup prompt. */
  prompt: string;
  /** Additional directories the agent may access (worktrees, evidence dir). */
  addDirs: string[];
  /** Per-project agent configuration (binary override, extra args). */
  binary: string;
  args: Record<string, string>;
}

export interface AgentAdapter {
  readonly id: string;
  readonly label: string;
  /** Prompt notes appended to every startup prompt for this agent (may be empty). */
  readonly promptNotes: string;
  /** Locate the binary: config override first, then well-known locations, then PATH. */
  resolveBinary(override?: string): Promise<{ path: string | null; via: string | null }>;
  /** Capabilities as reported to the UI. */
  capabilities(binaryPath: string | null): Promise<AgentCapabilities>;
  buildStart(context: AgentStartContext): SpawnSpec;
  /** Terminal command to resume a session in an attached terminal (null when unsupported). */
  buildResume(sessionId: string, context: AgentStartContext): SpawnSpec | null;
  /** Native deep link for opening a session (null when unsupported). */
  deepLink(sessionId: string): string | null;
  /** Extract a session/thread id from one streamed output line. */
  parseSessionLine(line: string): string | null;
}
