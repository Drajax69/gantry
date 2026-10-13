import { newId } from '@gantry/shared';
import type { Database } from '../db/db.js';
import type { Logger } from '../log.js';

/**
 * Durable background jobs. Every long-running operation (ticket starts,
 * installs, imports, remote sync requests) is a queued, phase-reporting job
 * so API calls return immediately and progress is visible and resumable.
 *
 * Guarantees:
 *  - `dedupeKey` keeps at most one queued/running job per logical operation
 *    (double-clicking Start cannot double-spawn an agent)
 *  - a job interrupted by a restart is re-queued once (bounded attempts) and
 *    its handler must be idempotent
 *  - handlers receive a progress callback; phases surface in the UI
 */

export type JobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export interface JobRow {
  id: string;
  kind: string;
  project_id: string | null;
  ticket_id: string | null;
  dedupe_key: string | null;
  state: JobState;
  phase: string | null;
  progress: number;
  detail: string | null;
  payload: string;
  result: string | null;
  error: string | null;
  attempts: number;
  run_after: string;
  lease_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobContext<P = Record<string, unknown>> {
  job: JobRow;
  payload: P;
  progress(phase: string, percent: number, detail?: string): void;
  log(line: string): void;
  signal: AbortSignal;
}

export type JobHandler = (context: JobContext) => Promise<unknown>;

const DEFAULT_MAX_ATTEMPTS = 3;
const LEASE_MS = 10 * 60_000;

export class JobQueue {
  private readonly handlers = new Map<string, JobHandler>();
  private timer: NodeJS.Timeout | null = null;
  private active = 0;
  private stopped = false;
  private readonly abort = new AbortController();
  /** Identity of THIS queue instance; claims record it so restarts can tell live leases from orphaned ones. */
  private readonly workerId = newId();

  constructor(
    private readonly db: Database,
    private readonly log: Logger,
    private readonly options: { maxAttempts?: number; retryBackoffMs?: number } = {},
  ) {}

  register(kind: string, handler: JobHandler): void {
    this.handlers.set(kind, handler);
  }

  enqueue(kind: string, options: { payload?: unknown; projectId?: string; ticketId?: string; dedupeKey?: string; runAfterMs?: number } = {}): JobRow {
    const now = new Date().toISOString();
    const id = newId();
    try {
      this.db
        .prepare(
          `INSERT INTO jobs (id, kind, project_id, ticket_id, dedupe_key, state, progress, payload, attempts, run_after, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'queued', 0, ?, 0, ?, ?, ?)`,
        )
        .run(id, kind, options.projectId ?? null, options.ticketId ?? null, options.dedupeKey ?? null, JSON.stringify(options.payload ?? {}), new Date(Date.now() + (options.runAfterMs ?? 0)).toISOString(), now, now);
      return this.get(id)!;
    } catch (error) {
      // The partial unique index keeps at most one active job per dedupe key:
      // a racing enqueue returns the existing job instead of failing.
      if (String((error as Error).message).includes('UNIQUE constraint failed: jobs.dedupe_key') && options.dedupeKey) {
        const existing = this.activeJobFor(options.dedupeKey);
        if (existing) return existing;
      }
      throw error;
    }
  }

  get(id: string): JobRow | null {
    return (this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id) as JobRow | undefined) ?? null;
  }

  activeJobFor(dedupeKey: string): JobRow | null {
    return (this.db.prepare("SELECT * FROM jobs WHERE dedupe_key=? AND state IN ('queued','running') ORDER BY created_at DESC LIMIT 1").get(dedupeKey) as JobRow | undefined) ?? null;
  }

  cancel(id: string): boolean {
    const result = this.db.prepare("UPDATE jobs SET state='canceled', updated_at=? WHERE id=? AND state='queued'").run(new Date().toISOString(), id);
    return Number(result.changes) > 0;
  }

  start(pollMs = 400): void {
    if (this.timer) return;
    this.recoverLeases();
    this.timer = setInterval(() => void this.pump(), pollMs);
    this.timer.unref();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.abort.abort();
  }

  /** Re-queue jobs whose worker died or whose lease expired (bounded attempts). */
  recoverLeases(): void {
    const now = new Date().toISOString();
    const expired = this.db
      .prepare("SELECT * FROM jobs WHERE state='running' AND (worker_id IS NULL OR worker_id != ? OR lease_until IS NULL OR lease_until < ?)")
      .all(this.workerId, now) as unknown as JobRow[];
    for (const job of expired) {
      // The claim itself counts the attempt; recovery only releases the lease,
      // so a killed process's job does not burn two attempts per restart.
      if (job.attempts >= (this.options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)) {
        this.db.prepare("UPDATE jobs SET state='failed', error=?, updated_at=? WHERE id=?").run('Gantry restarted while this job was running, and it did not resume.', now, job.id);
        this.log.warn(`job ${job.kind} ${job.id} failed after restart (${job.attempts} attempts)`);
      } else {
        this.db.prepare("UPDATE jobs SET state='queued', phase=NULL, lease_until=NULL, worker_id=NULL, run_after=?, updated_at=? WHERE id=?").run(now, now, job.id);
        this.log.info(`requeued job ${job.kind} ${job.id} after restart (attempt ${job.attempts})`);
      }
    }
  }

  private async pump(): Promise<void> {
    if (this.stopped || this.active >= 4) return;
    try {
      await this.claimAndRun();
    } catch (error) {
      if (!this.stopped) this.log.warn(`job pump failed: ${(error as Error).message}`);
    }
  }

  private async claimAndRun(): Promise<void> {
    const now = new Date().toISOString();
    const candidate = this.db
      .prepare("SELECT * FROM jobs WHERE state='queued' AND run_after <= ? ORDER BY created_at LIMIT 1")
      .get(now) as JobRow | undefined;
    if (!candidate) return;
    const claimed = this.db
      .prepare("UPDATE jobs SET state='running', worker_id=?, lease_until=?, attempts=attempts+1, updated_at=? WHERE id=? AND state='queued'")
      .run(this.workerId, new Date(Date.now() + LEASE_MS).toISOString(), now, candidate.id);
    if (Number(claimed.changes) === 0) return;
    this.active += 1;
    void this.runJob(this.get(candidate.id)!).finally(() => {
      this.active -= 1;
      void this.pump();
    });
  }

  private async runJob(job: JobRow): Promise<void> {
    const handler = this.handlers.get(job.kind);
    if (!handler) {
      this.fail(job, `No handler registered for job kind "${job.kind}"`);
      return;
    }
    this.log.info(`job ${job.kind} ${job.id} started (attempt ${job.attempts})`);
    const jobLog: string[] = [];
    const context: JobContext = {
      job,
      payload: safeParse(job.payload),
      progress: (phase, percent, detail) => {
        this.db.prepare('UPDATE jobs SET phase=?, progress=?, detail=?, updated_at=? WHERE id=? AND state=\'running\'').run(phase, Math.max(0, Math.min(100, Math.round(percent))), detail ?? null, new Date().toISOString(), job.id);
      },
      log: (line) => {
        jobLog.push(`${new Date().toISOString()} ${line}`);
        this.log.info(`job ${job.kind}: ${line}`);
      },
      signal: this.abort.signal,
    };
    try {
      const result = await handler(context);
      this.db
        .prepare("UPDATE jobs SET state='succeeded', phase='done', progress=100, result=?, updated_at=? WHERE id=?")
        .run(result === undefined ? null : JSON.stringify(result), new Date().toISOString(), job.id);
      this.log.info(`job ${job.kind} ${job.id} succeeded`);
    } catch (error) {
      const message = (error as Error).message;
      context.log(`failed: ${message}`);
      if (job.attempts < (this.options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS) && !(error as Error).name?.startsWith('Fatal')) {
        const backoffMs = this.options.retryBackoffMs ?? 5_000;
        this.db
          .prepare("UPDATE jobs SET state='queued', phase='retrying', error=?, run_after=?, updated_at=? WHERE id=?")
          .run(message, new Date(Date.now() + backoffMs * job.attempts).toISOString(), new Date().toISOString(), job.id);
      } else {
        this.fail(job, message);
      }
    }
  }

  private fail(job: JobRow, message: string): void {
    this.db.prepare("UPDATE jobs SET state='failed', error=?, detail=NULL, updated_at=? WHERE id=?").run(message, new Date().toISOString(), job.id);
    this.log.error(`job ${job.kind} ${job.id} failed: ${message}`);
  }
}

function safeParse(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}
