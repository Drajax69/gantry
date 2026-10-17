import "server-only";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { CLI, getAgent } from "./agents/store";
import { HOME, git, withLock } from "./exec";
import { httpError } from "./http";
import { loadChat, pendingFor } from "./chats";
import { ticketContext, type TicketWorkspace } from "./ticket-chat";

const exec = promisify(execFile);
const directory = path.join(HOME, "ticket-conversations");
export interface TicketConversation {
  ticketId: string;
  agentId: string;
  provider: "codex" | "claude";
  providerName: string;
  model: string;
  sessionId: string;
  previousSessionIds?: string[];
  cwd: string;
  branch: string;
  checkouts: { repositoryId: string; path: string }[];
  context: string;
  createdAt: number;
}
const fileFor = (id: string) => {
  if (!/^[\w-]+$/.test(id)) throw httpError(400, "Invalid ticket.");
  return path.join(directory, `${id}.json`);
};
export function conversationFor(id: string): TicketConversation | null {
  try { return JSON.parse(fs.readFileSync(fileFor(id), "utf8")); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
}
function save(record: TicketConversation) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = fileFor(record.ticketId);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(record, null, 2), { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
}
function contextFor(work: TicketWorkspace) {
  return [
    `Gantry ticket: ${work.ticket.title}`, `Ticket ID: ${work.ticket.id}`, `Branch: ${work.ticket.branch}`,
    work.ticket.description, work.ticket.additions || "", work.prompt || "",
    `Workspace instructions: ${path.join(work.project.workspace, "AGENTS.md")}`,
    "Prepared ticket worktrees:", ...work.checkouts.map(c => `${c.repositoryId}: ${c.path}`),
    "Read workspace and repository instructions. Work in the prepared worktrees, preserve unrelated changes, and validate the feature. Follow the workspace starting prompt above for delivery and validation. Gantry associates PRs on this branch with this ticket. Do not merge or deploy.",
  ].filter(Boolean).join("\n\n");
}

/** Create a durable Codex thread without sending a turn or invoking a model. */
async function createCodexThread(record: Omit<TicketConversation, "sessionId">, existingId?: string): Promise<string> {
  const child = spawn(CLI.codex, ["app-server"], { cwd: record.cwd, stdio: ["pipe", "pipe", "pipe"] });
  let nextId = 0;
  let buffer = "";
  const waiting = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  const fail = (error: Error) => { for (const entry of waiting.values()) { clearTimeout(entry.timer); entry.reject(error); } waiting.clear(); };
  child.on("error", fail);
  child.on("exit", () => fail(new Error("Codex app server exited before creating the conversation.")));
  child.stdin.on("error", fail);
  child.stderr.on("data", () => {});
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (text: string) => {
    buffer += text;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      try {
        const message = JSON.parse(line);
        const entry = waiting.get(message.id);
        if (!entry) continue;
        waiting.delete(message.id); clearTimeout(entry.timer);
        if (message.error) entry.reject(new Error(message.error.message || "Codex could not create a conversation."));
        else entry.resolve(message.result || {});
      } catch { /* Non-protocol output is not a response. */ }
    }
  });
  const call = (method: string, params: unknown) => new Promise<Record<string, unknown>>((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error("Codex did not respond. Check its installation and try again.")); }, 20000);
    waiting.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
  });
  try {
    await call("initialize", { clientInfo: { name: "gantry", version: "0.1.0" }, capabilities: { experimentalApi: true } });
    child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
    if (existingId) {
      try {
        const existing = await call("thread/read", { threadId: existingId, includeTurns: false });
        const rollout = (existing.thread as { path?: string })?.path;
        if (!rollout) throw new Error("Codex returned no conversation file. Retry after updating Codex.");
        await fs.promises.access(rollout);
        return existingId;
      } catch (error) {
        const e = error as NodeJS.ErrnoException;
        if (e.code !== "ENOENT" && !/no rollout found|thread .*not found|failed to resolve rollout path|does not exist/i.test(e.message)) throw error;
      }
    }
    const response = await call("thread/start", {
      cwd: record.cwd, ephemeral: false, developerInstructions: record.context,
      sandbox: "workspace-write", approvalPolicy: "on-request",
      ...(record.model ? { model: record.model } : {}),
      config: { "sandbox_workspace_write.writable_roots": record.checkouts.map(c => c.path) },
    });
    const id = (response.thread as { id?: string })?.id;
    if (!id || !/^[\w-]+$/.test(id)) throw new Error("Codex did not return a conversation ID.");
    // thread/start is lazy: materialize history without starting model execution.
    await call("thread/inject_items", { threadId: id, items: [{ type: "message", role: "user", content: [{ type: "input_text", text: record.context }] }] });
    const rollout = (response.thread as { path?: string })?.path;
    if (!rollout) throw new Error("Codex did not return a durable conversation path.");
    await fs.promises.access(rollout);
    save({ ...record, sessionId: id });
    await call("thread/name/set", { threadId: id, name: `Gantry · ${record.branch}` }).catch(() => {});
    return id;
  } finally { child.stdin.end(); child.kill(); fail(new Error("Codex connection closed.")); }
}

const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
function claudeSessionExists(id: string) {
  const projects = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "projects");
  try { return fs.readdirSync(projects, { withFileTypes: true }).some(d => d.isDirectory() && fs.existsSync(path.join(projects, d.name, `${id}.jsonl`))); }
  catch { return false; }
}
async function launch(record: TicketConversation) {
  if (record.provider === "codex" && process.platform === "darwin") {
    await exec("open", [`codex://threads/${record.sessionId}`], { timeout: 15000 });
    return;
  }
  const args = record.provider === "claude"
    ? [CLI.claude, ...(claudeSessionExists(record.sessionId) ? ["--resume", record.sessionId] : ["--session-id", record.sessionId]), "--append-system-prompt", record.context, ...(record.model ? ["--model", record.model] : []), ...record.checkouts.flatMap(c => ["--add-dir", c.path])]
    : [CLI.codex, "resume", record.sessionId, "-C", record.cwd];
  if (process.platform === "darwin") {
    const command = `cd ${quote(record.cwd)} && ${["env", `PATH=${process.env.PATH || ""}`, ...args].map(quote).join(" ")}`;
    // Arguments enter AppleScript as data, then shell arguments are individually quoted.
    await exec("osascript", ["-e", `on run argv
      set sessionTitle to item 1 of argv
      set launchCommand to item 2 of argv
      tell application "Terminal"
        repeat with w in windows
          repeat with t in tabs of w
            if custom title of t is sessionTitle then
              if not busy of t then do script launchCommand in t
              set selected tab of w to t
              set index of w to 1
              activate
              return
            end if
          end repeat
        end repeat
        set t to do script launchCommand
        set custom title of t to sessionTitle
        activate
      end tell
    end run`, `Gantry ${record.sessionId}`, command], { timeout: 15000 });
  } else if (process.platform === "linux") {
    const child = spawn("x-terminal-emulator", ["-e", ...args], { cwd: record.cwd, detached: true, stdio: "ignore" });
    await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
    child.unref();
  } else throw httpError(409, "External conversations currently support macOS and Linux.");
}

export async function openTicketConversation(ticketId: string) {
  return withLock(`ticket-conversation:${ticketId}`, async () => {
    let record = conversationFor(ticketId);
    // Resolve the ticket even on resume; deleted tickets must not launch a stale record.
    const existing = await ticketContext(ticketId);
    if (existing.ticket.status !== "in_progress") throw httpError(409, "Move this ticket to In progress to open its conversation.");
    if (pendingFor(`ticket/${ticketId}`)) throw httpError(409, "The previous embedded agent is still running. Wait for it to finish, then retry.");
    if (!record) {
      const agent = getAgent();
      if (agent.kind === "openai") throw httpError(409, "This provider is an API endpoint, not an external coding app. Choose Codex or Claude in Settings to create a ticket conversation.");
      const work = await ticketContext(ticketId, true);
      const cwd = work.checkouts[0]?.path;
      if (!cwd) throw httpError(409, "This ticket has no worktrees.");
      for (const checkout of work.checkouts) {
        if ((await git(checkout.path, "branch", "--show-current")).trim() !== work.ticket.branch) throw httpError(409, "A ticket worktree changed branches. Restore its ticket branch before opening a conversation.");
      }
      const base = { ticketId, agentId: agent.id, provider: agent.kind, providerName: agent.name, model: agent.model, cwd, branch: work.ticket.branch, checkouts: work.checkouts, context: contextFor(work), createdAt: Date.now() };
      // Reuse a real session from the former embedded chat when it exists.
      const previous = loadChat(`ticket/${ticketId}`)?.sessions?.[agent.id]?.id;
      const sessionId = previous && /^[0-9a-f-]{36}$/i.test(previous) ? previous : agent.kind === "codex" ? await createCodexThread(base) : randomUUID();
      record = { ...base, sessionId };
      save(record);
    } else if (record.branch !== existing.ticket.branch) {
      throw httpError(409, "This ticket is linked to a conversation on its original branch. Restore that branch to reopen the same conversation.");
    }
    if (record.provider === "codex") {
      const id = await createCodexThread(record, record.sessionId);
      if (id !== record.sessionId) {
        record = { ...record, previousSessionIds: [...(record.previousSessionIds ?? []), record.sessionId], sessionId: id };
        save(record);
      }
    }
    await launch(record);
    return { conversation: publicConversation(record) };
  });
}
export function publicConversation(record: TicketConversation | null) {
  if (!record) return null;
  const { ticketId, provider, providerName, sessionId, branch, createdAt } = record;
  return { ticketId, provider, providerName, sessionId, branch, createdAt };
}
