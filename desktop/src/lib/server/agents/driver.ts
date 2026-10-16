import "server-only";
import { spawn } from "node:child_process";
import type { ToolUse } from "@/lib/types";
import type { StoredAgent } from "./store";

/** What a driver reports while it answers. */
export interface RunHooks {
  text(t: string): void;
  tool(t: ToolUse): void;
  /** The agent's own session id, for continuing the conversation next time. */
  session(id: string): void;
  /** Cost of the whole session so far, when the agent reports one. */
  cost(totalUsd: number): void;
  error(message: string): void;
}

export interface Turn {
  role: "user" | "assistant";
  text: string;
}

export interface RunInput {
  agent: StoredAgent;
  /** The editable local checkout under review. */
  cwd: string;
  checkouts?: { repositoryId: string; path: string }[];
  system: string;
  prompt: string;
  /** The session this agent had for this chat, if any. */
  sessionId: string | null;
  /** Earlier questions and answers in this chat, for agents without a session to resume. */
  history: Turn[];
  hooks: RunHooks;
  signal: AbortSignal;
}

/** Answers one question; resolves when the answer is complete, stopped or failed. */
export type Driver = (input: RunInput) => Promise<void>;

/** Run a CLI, feeding stdin and handing each stdout line to `onLine`. */
export function runCli(
  cmd: string,
  args: string[],
  opts: { cwd: string; stdin: string; signal: AbortSignal; onLine: (line: string) => void },
): Promise<{ code: number | null; stopped: boolean; killed?: string; stderr: string; spawnError?: Error }> {
  return new Promise((resolve) => {
    const child = spawn(/*turbopackIgnore: true*/ cmd, args, {
      cwd: opts.cwd, env: process.env, stdio: ["pipe", "pipe", "pipe"], signal: opts.signal, killSignal: "SIGTERM",
    });
    child.stdin.on("error", () => {});
    child.stdin.end(opts.stdin);
    let buf = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        opts.onLine(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    let done = false;
    child.on("error", (err) => {
      if (done || err.name === "AbortError") return;
      done = true;
      resolve({ code: null, stopped: false, stderr, spawnError: err });
    });
    child.on("close", (code, signal) => {
      if (done) return;
      done = true;
      if (buf.trim()) opts.onLine(buf);
      // Only our own abort counts as stopped; a signal from anywhere else is a crash worth explaining.
      resolve({ code, stopped: opts.signal.aborted, ...(signal && !opts.signal.aborted ? { killed: signal } : {}), stderr });
    });
  });
}

/** Shared handling of how a CLI run ended. */
export function cliOutcome(
  name: string,
  cmd: string,
  r: Awaited<ReturnType<typeof runCli>>,
  hooks: RunHooks,
  failed: boolean,
) {
  if (r.spawnError) {
    hooks.error(`Couldn't start "${cmd}": ${r.spawnError.message}. Is the ${name} CLI installed and on PATH?`);
  } else if (r.stopped) {
    hooks.error("Stopped.");
  } else if (r.killed) {
    const tail = r.stderr.trim().split("\n").slice(-3).join(" ");
    hooks.error(`${name} was killed (${r.killed}) before it finished.${tail ? ` ${tail}` : ""}`);
  } else if (r.code !== 0 && !failed) {
    hooks.error(r.stderr.trim().split("\n").slice(-3).join(" ") || `${cmd} exited with code ${r.code}`);
  }
}

/** Earlier conversation, as text, for an agent joining a chat another agent started. */
export function transcript(history: Turn[], max = 12_000): string {
  if (!history.length) return "";
  let out = "";
  for (const t of [...history].reverse()) {
    const line = `${t.role === "user" ? "Reviewer" : "Assistant"}: ${t.text}\n\n`;
    if (out.length + line.length > max) break;
    out = line + out;
  }
  return `Earlier in this review the reviewer talked with another assistant:\n\n${out}---\n\n`;
}

export function toolDetail(input: Record<string, unknown> | undefined): string {
  if (!input) return "";
  const v = input.command ?? input.file_path ?? input.pattern ?? input.path ?? input.url;
  return typeof v === "string" ? v : JSON.stringify(input).slice(0, 200);
}
