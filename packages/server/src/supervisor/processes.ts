import { run, signalGroup } from '../util/exec.js';

/**
 * Process ownership. Every pid Gantry records is re-verified before it is
 * signaled: the process must exist, its process group must match the recorded
 * pgid, and its command line must still contain the recorded claim (the
 * checkout path or marker arguments Gantry passed at spawn time). This is
 * what makes takeover and shutdown safe after a manager restart.
 */

interface PsRecord {
  pgid: string;
  command: string;
}

async function psRecord(pid: number): Promise<PsRecord | null> {
  if (!Number.isInteger(pid) || pid < 2) return null;
  try {
    const output = await run('ps', ['-p', String(pid), '-o', 'pgid=,command='], { timeoutMs: 5000 });
    // `ps` pads columns with leading whitespace; trim before splitting.
    const trimmed = output.replace(/^\s+/, '');
    const split = trimmed.indexOf(' ');
    if (split < 0) return { pgid: trimmed.trim(), command: '' };
    return { pgid: trimmed.slice(0, split).trim(), command: trimmed.slice(split + 1).trim() };
  } catch {
    return null;
  }
}

export async function processAlive(pid: number): Promise<boolean> {
  return (await psRecord(pid)) !== null;
}

/**
 * Verify a recorded (pid, pgid, claim) triple still identifies a process we
 * started. On Linux `ps -o pgid=` is available; on all POSIX platforms this
 * works. Windows support uses tasklist-based checks in a follow-up.
 */
export async function ownsProcess(pid: number, pgid: number, claim: string): Promise<boolean> {
  const record = await psRecord(pid);
  if (!record) return false;
  if (String(pgid) !== record.pgid) return false;
  if (claim && !record.command.includes(claim)) return false;
  return true;
}

export interface InterruptResult {
  interrupted: boolean;
  escalated: boolean;
}

/**
 * Interrupt a process group: SIGTERM first (graceful), then SIGKILL after the
 * grace period. Returns which stages ran so callers can report precise state.
 */
export async function interruptProcessGroup(pid: number, pgid: number, claim: string, graceMs: number): Promise<InterruptResult> {
  if (!(await ownsProcess(pid, pgid, claim))) return { interrupted: false, escalated: false };
  signalGroup(pgid, 'SIGTERM', pid);
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!(await processAlive(pid))) return { interrupted: true, escalated: false };
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  if (await ownsProcess(pid, pgid, claim)) {
    signalGroup(pgid, 'SIGKILL', pid);
    await new Promise((resolve) => setTimeout(resolve, 250));
    return { interrupted: true, escalated: true };
  }
  return { interrupted: true, escalated: false };
}
