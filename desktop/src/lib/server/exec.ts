import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const run = promisify(execFile);
const MAX = 512 * 1024 * 1024;

export const HOME = process.env.PR_LENS_HOME || path.join(os.homedir(), ".pr-lens");
export const DIRS = {
  repos: path.join(HOME, "repos"),
  worktrees: path.join(HOME, "worktrees"),
  chats: path.join(HOME, "chats"),
};
for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });

export class CommandError extends Error {
  constructor(message: string, readonly stderr: string) {
    super(message);
  }
}

async function exec(cmd: string, args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout } = await run(cmd, args, { cwd, maxBuffer: MAX, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    return stdout;
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    const stderr = (err.stderr || err.message || "").trim();
    throw new CommandError(`${cmd} ${args.slice(0, 3).join(" ")}… failed: ${stderr.split("\n").slice(-3).join(" ")}`, stderr);
  }
}

/** Local git command. */
export const git = (dir: string, ...args: string[]) => exec("git", ["-C", dir, ...args]);

/** Networked git command, authenticated through the gh CLI so private repos work over https. */
export const gitNet = (dir: string, ...args: string[]) =>
  exec("git", ["-C", dir, "-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential", ...args]);

export const gh = (...args: string[]) => exec("gh", args);

export const safeName = (s: string) => s.replace(/[^\w.-]+/g, "_");

/** Serialize async work per key (e.g. one git operation at a time per repo). */
const locks: Map<string, Promise<unknown>> = ((globalThis as unknown as { __lensLocks?: Map<string, Promise<unknown>> }).__lensLocks ??= new Map());
export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  locks.set(key, next);
  return next;
}
