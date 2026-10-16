import "server-only";
import { CLI } from "./store";
import { cliOutcome, runCli, transcript, type Driver } from "./driver";

/** The parts of `codex exec --json` lines we read. */
interface CodexLine {
  type?: string;
  thread_id?: string;
  message?: string;
  error?: { message?: string };
  item?: {
    type?: string;
    text?: string;
    command?: string;
    server?: string;
    tool?: string;
    query?: string;
    changes?: { path: string }[];
  };
}

export const codex: Driver = async ({ agent, cwd, system, prompt, sessionId, history, hooks, signal, checkouts }) => {
  // Allow edits inside the review workspace,
  // and none of your ~/.codex config, so no MCP servers, profiles or execpolicy rules.
  // Login still comes from ~/.codex.
  const args = [
    "exec", "--json",
    "--ignore-user-config", "--ignore-rules",
    "--skip-git-repo-check",
    "--sandbox", "workspace-write",
  ];
  if (checkouts) {
    for (const c of checkouts) args.push("--add-dir", c.path);
    args.push("-c", "sandbox_workspace_write.network_access=true");
  }
  if (agent.model) args.push("--model", agent.model);
  // Codex has no flag for extra system instructions, so a new session gets them up front.
  if (sessionId) args.push("resume", sessionId, "-");
  else args.push("-");
  const stdin = sessionId ? `${system}\n\n${prompt}` : `${system}\n\n${transcript(history)}${prompt}`;

  let wrote = false;
  let failed = false;
  let lastError = "";
  const r = await runCli(CLI.codex, args, {
    cwd, signal, stdin,
    onLine(line) {
      let ev: CodexLine;
      try {
        ev = JSON.parse(line) as CodexLine;
      } catch {
        return;
      }
      if (ev.type === "thread.started" && ev.thread_id) hooks.session(ev.thread_id);
      else if (ev.type === "item.started" || ev.type === "item.completed") {
        const it = ev.item ?? {};
        if (ev.type === "item.completed" && it.type === "agent_message" && it.text) {
          hooks.text((wrote ? "\n\n" : "") + it.text);
          wrote = true;
        } else if (ev.type === "item.started" && it.type === "command_execution") {
          hooks.tool({ name: "shell", detail: it.command ?? "" });
        } else if (ev.type === "item.started" && it.type === "mcp_tool_call") {
          hooks.tool({ name: `${it.server}.${it.tool}`, detail: "" });
        } else if (ev.type === "item.started" && it.type === "web_search") {
          hooks.tool({ name: "web search", detail: it.query ?? "" });
        }
      } else if (ev.type === "turn.failed") {
        failed = true;
        hooks.error(ev.error?.message || "Codex stopped.");
      } else if (ev.type === "error" && ev.message) {
        lastError = ev.message;
      }
    },
  });
  if (!failed && !r.stopped && r.code !== 0 && lastError) {
    failed = true;
    hooks.error(lastError);
  }
  cliOutcome("Codex", CLI.codex, r, hooks, failed);
};
