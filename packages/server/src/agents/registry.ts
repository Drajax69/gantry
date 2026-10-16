import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { newId } from '@gantry/shared';
import type { Database } from '../db/db.js';
import type { AppContext } from '../config/app.js';
import type { Logger } from '../log.js';
import type { LoadedProject } from '../projects/registry.js';
import { rotateLog } from '../supervisor/supervisor.js';
import { interruptProcessGroup, ownsProcess, processAlive } from '../supervisor/processes.js';
import { spawnDetached, type SpawnHandle } from '../util/exec.js';
import { CodexAdapter, ClaudeCodeAdapter, OpenCodeAdapter, GenericAdapter } from './adapters.js';
import type { AgentAdapter, SpawnSpec } from './types.js';
import type { TicketRow } from '../tickets/store.js';

/**
 * Agent run engine. Runs are detached process-group leaders whose pids are
 * recorded with an ownership claim; after a Gantry restart the claim is
 * re-verified before any signal is sent. Session ids are parsed from the
 * streamed output and persisted, which is what makes resume/deep-link work.
 */

export interface RunRow {
  id: string;
  ticket_id: string;
  project_id: string;
  agent: string;
  state: 'starting' | 'running' | 'ready' | 'finished' | 'failed' | 'interrupting';
  session_id: string | null;
  workspace: string | null;
  pid: number | null;
  pgid: number | null;
  pid_claim: string | null;
  started_at: string | null;
  ended_at: string | null;
  exit_code: number | null;
  error: string | null;
}

export class AgentRegistry {
  readonly adapters = new Map<string, AgentAdapter>();
  private readonly live = new Map<string, { spec: SpawnSpec; logFile: string }>();

  constructor(
    private readonly ctx: AppContext,
    private readonly db: Database,
    private readonly log: Logger,
  ) {
    for (const adapter of [new CodexAdapter(), new ClaudeCodeAdapter(), new OpenCodeAdapter(), new GenericAdapter()]) {
      this.adapters.set(adapter.id, adapter);
    }
  }

  get(id: string): AgentAdapter | null {
    return this.adapters.get(id) ?? null;
  }

  ids(): string[] {
    return [...this.adapters.keys()];
  }

  agentConfig(project: LoadedProject, agentId: string): { binary?: string; args: Record<string, string> } {
    const configured = project.config.agents.find((agent) => agent.id === agentId);
    return { binary: configured?.binary, args: configured?.args ?? {} };
  }

  async describe(project: LoadedProject): Promise<
    {
      id: string;
      capabilities: Awaited<ReturnType<AgentAdapter['capabilities']>>;
      configured: boolean;
    }[]
  > {
    const result = [] as { id: string; capabilities: Awaited<ReturnType<AgentAdapter['capabilities']>>; configured: boolean }[];
    for (const adapter of this.adapters.values()) {
      const config = this.agentConfig(project, adapter.id);
      const resolved = await adapter.resolveBinary(config.binary);
      result.push({ id: adapter.id, capabilities: await adapter.capabilities(resolved.path), configured: Boolean(config.binary) });
    }
    return result;
  }

  runRow(id: string): RunRow | null {
    return (this.db.prepare('SELECT * FROM runs WHERE id=?').get(id) as RunRow | undefined) ?? null;
  }

  activeRunForTicket(ticketId: string): RunRow | null {
    return (this.db.prepare("SELECT * FROM runs WHERE ticket_id=? AND state IN ('starting','running','interrupting') ORDER BY started_at DESC LIMIT 1").get(ticketId) as RunRow | undefined) ?? null;
  }

  /**
   * Start an agent run for a ticket. The caller must have claimed
   * tickets.active_run_id first (atomic start lock).
   */
  async startRun(project: LoadedProject, ticket: TicketRow, runId: string, options: { agentId: string; prompt: string; addDirs: string[]; artifactDir: string; workspace?: string }): Promise<RunRow> {
    const adapter = this.adapters.get(options.agentId);
    if (!adapter) throw new Error(`Unknown agent "${options.agentId}". Available: ${this.ids().join(', ')}`);
    const config = this.agentConfig(project, options.agentId);
    const resolved = await adapter.resolveBinary(config.binary);
    if (!resolved.path) {
      throw new Error(`${adapter.label} is not installed${resolved.via === 'config' ? ` (configured binary not found: ${config.binary})` : '. Install it, or pick another agent.'}`);
    }
    const workspace = options.workspace ?? path.dirname(options.addDirs[0] ?? project.workspace);
    const logFile = path.join(this.ctx.logsDir, `run-${runId}.log`);
    await fsp.mkdir(path.dirname(logFile), { recursive: true, mode: 0o700 });
    await rotateLog(logFile);

    const spec = adapter.buildStart({ workspace, prompt: options.prompt, addDirs: options.addDirs, binary: resolved.path, args: config.args });
    const fd = fs.openSync(logFile, 'a', 0o600);
    let handle: SpawnHandle;
    try {
      handle = spawnDetached(spec.argv[0]!, spec.argv.slice(1), {
        cwd: spec.cwd,
        env: { GANTRY_RUN_ID: runId, GANTRY_TICKET_ID: ticket.id } as NodeJS.ProcessEnv,
        onStdout: (chunk) => this.onChunk(runId, adapter, chunk, logFile),
        onStderr: (chunk) => fs.appendFileSync(logFile, chunk),
      });
    } finally {
      fs.closeSync(fd);
    }
    this.live.set(runId, { spec, logFile });
    this.db
      .prepare(
        `UPDATE runs SET agent=?, state='running', workspace=?, pid=?, pgid=?, pid_claim=?, started_at=COALESCE(started_at, ?), error=NULL WHERE id=?`,
      )
      .run(options.agentId, workspace, handle.pid, handle.pgid, spec.claim, new Date().toISOString(), runId);
    this.log.info(`Started ${adapter.label} run ${runId} for ticket ${ticket.id} (pid ${handle.pid})`);
    void this.watch(runId, adapter, handle.exited);
    return this.runRow(runId)!;
  }

  private onChunk(runId: string, adapter: AgentAdapter, chunk: Buffer, logFile: string): void {
    fs.appendFileSync(logFile, chunk);
    for (const line of chunk.toString('utf8').split('\n')) {
      const sessionId = adapter.parseSessionLine(line.trim());
      if (sessionId) {
        this.db.prepare("UPDATE runs SET session_id=?, state='running' WHERE id=? AND (session_id IS NULL OR session_id != ?)").run(sessionId, runId, sessionId);
      }
    }
  }

  private async watch(runId: string, adapter: AgentAdapter, exited: Promise<number>): Promise<void> {
    const code = await exited;
    this.live.delete(runId);
    const run = this.runRow(runId);
    if (!run) return;
    if (run.state === 'interrupting') {
      // A deliberate takeover: the session stays usable via resume/deep link.
      this.db.prepare("UPDATE runs SET state='ready', ended_at=?, error=NULL WHERE id=?").run(new Date().toISOString(), runId);
    } else {
      const finished = code === 0;
      this.db
        .prepare('UPDATE runs SET state=?, ended_at=?, exit_code=?, error=? WHERE id=?')
        .run(finished ? 'finished' : 'failed', new Date().toISOString(), code, finished ? null : `${adapter.label} exited with status ${code}.`, runId);
    }
    this.db.prepare('UPDATE tickets SET active_run_id=NULL, updated_at=? WHERE id=? AND active_run_id=?').run(new Date().toISOString(), run.ticket_id, runId);
    this.log.info(`Run ${runId} (${adapter.label}) exited with code ${code}`);
  }

  /**
   * Take over: interrupt the background run quickly but safely. Explicit
   * states — `interrupting` while signaling, `ready` once the session is
   * free, `failed` when ownership could not be verified.
   */
  async takeover(runId: string, graceMs: number): Promise<{ ok: boolean; sessionId: string | null; deepLink: string | null; error?: string }> {
    const run = this.runRow(runId);
    if (!run) return { ok: false, sessionId: null, deepLink: null, error: 'Run not found.' };
    const adapter = this.adapters.get(run.agent);
    if (!adapter) return { ok: false, sessionId: run.session_id, deepLink: null, error: `Agent "${run.agent}" is no longer registered.` };
    if (!run.session_id && adapter.id !== 'generic') return { ok: false, sessionId: null, deepLink: null, error: 'The agent has not reported a session id yet — it is still starting.' };
    if (run.state === 'finished' || run.state === 'ready') {
      return { ok: true, sessionId: run.session_id, deepLink: run.session_id ? adapter.deepLink(run.session_id) : null };
    }
    this.db.prepare("UPDATE runs SET state='interrupting' WHERE id=?").run(runId);
    try {
      if (run.pid && run.pgid !== null) {
        const alive = run.pid_claim ? await ownsProcess(run.pid, run.pgid, run.pid_claim) : await processAlive(run.pid);
        if (alive) {
          const result = await interruptProcessGroup(run.pid, run.pgid, run.pid_claim ?? '', graceMs);
          if (!result.interrupted) {
            this.db.prepare("UPDATE runs SET state='failed', error='Could not verify the agent process for takeover.' WHERE id=?").run(runId);
            return { ok: false, sessionId: run.session_id, deepLink: null, error: 'The recorded agent process could not be verified; nothing was signaled.' };
          }
        } else if (this.live.has(runId)) {
          // In-memory child already gone; the watcher will finalize.
        }
      } else if (!this.live.has(runId)) {
        // Nothing to interrupt: process never recorded or already reaped.
        this.db.prepare("UPDATE runs SET state='ready', ended_at=? WHERE id=?").run(new Date().toISOString(), runId);
      }
    } catch (error) {
      this.db.prepare("UPDATE runs SET state='failed', error=? WHERE id=?").run(`Takeover failed: ${(error as Error).message}`, runId);
      return { ok: false, sessionId: run.session_id, deepLink: null, error: (error as Error).message };
    }
    // If the in-memory child is still closing, wait briefly for the watcher
    // to flip the state to `ready` (bounded — takeover must feel fast).
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const current = this.runRow(runId);
      if (!current || current.state === 'ready' || current.state === 'finished' || current.state === 'failed') break;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    const final = this.runRow(runId)!;
    if (final.state === 'interrupting') {
      this.db.prepare("UPDATE runs SET state='ready', ended_at=? WHERE id=?").run(new Date().toISOString(), runId);
    }
    return { ok: true, sessionId: final.session_id, deepLink: final.session_id ? adapter?.deepLink(final.session_id) ?? null : null };
  }

  /** Startup recovery: re-verify recorded runs; adopt live processes, close dead rows. */
  async recoverAfterRestart(): Promise<void> {
    const rows = this.db.prepare("SELECT * FROM runs WHERE state IN ('starting','running','interrupting')").all() as unknown as RunRow[];
    for (const run of rows) {
      const alive = run.pid && run.pgid !== null && run.pid_claim ? await ownsProcess(run.pid, run.pgid, run.pid_claim) : run.pid ? await processAlive(run.pid) : false;
      if (alive) {
        this.log.info(`Recovered run ${run.id} (${run.agent}) — process ${run.pid} still running`);
      } else {
        this.db
          .prepare("UPDATE runs SET state=?, ended_at=?, error=? WHERE id=?")
          .run(run.session_id ? 'ready' : 'failed', new Date().toISOString(), run.session_id ? null : 'Agent process ended while Gantry was stopped.', run.id);
        this.db.prepare('UPDATE tickets SET active_run_id=NULL WHERE id=? AND active_run_id=?').run(run.ticket_id, run.id);
      }
    }
  }

  /** Liveness poll for adopted runs (no in-memory child to watch). */
  async pollAdopted(): Promise<void> {
    const rows = this.db.prepare("SELECT * FROM runs WHERE state IN ('running','starting','interrupting')").all() as unknown as RunRow[];
    for (const run of rows) {
      if (this.live.has(run.id)) continue;
      const alive = run.pid ? await processAlive(run.pid) : false;
      if (!alive) {
        const adapter = this.adapters.get(run.agent);
        if (run.state === 'interrupting') {
          this.db.prepare("UPDATE runs SET state='ready', ended_at=? WHERE id=?").run(new Date().toISOString(), run.id);
        } else {
          this.db.prepare("UPDATE runs SET state=?, ended_at=?, exit_code=-1, error=? WHERE id=?").run('finished', new Date().toISOString(), null, run.id);
        }
        this.db.prepare('UPDATE tickets SET active_run_id=NULL WHERE id=? AND active_run_id=?').run(run.ticket_id, run.id);
        void adapter;
      }
    }
  }

  createRunRow(projectId: string, ticketId: string, agentId: string): string {
    const id = newId();
    this.db
      .prepare("INSERT INTO runs (id, ticket_id, project_id, agent, state, created_at) VALUES (?, ?, ?, ?, 'starting', ?)")
      .run(id, ticketId, projectId, agentId, new Date().toISOString());
    return id;
  }
}
