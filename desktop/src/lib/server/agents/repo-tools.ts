import "server-only";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Inspection and editing tools for API agents. Everything is confined to
 * the checkout, and git runs without a shell and without options that write files.
 */
export const TOOL_SPECS = [
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Create or replace a UTF-8 file inside the checkout. Read existing files first. Changes remain local.",
      parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description: "Replace one exact, unique occurrence of old_text in a file with new_text. Read the file first.",
      parameters: { type: "object", properties: { path: { type: "string" }, old_text: { type: "string" }, new_text: { type: "string" } }, required: ["path", "old_text", "new_text"] },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a file from the checkout, with line numbers. Use start_line/end_line for big files.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to the repository root" },
          start_line: { type: "integer" },
          end_line: { type: "integer" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List tracked files under a directory (default: the whole repository).",
      parameters: { type: "object", properties: { path: { type: "string" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "search",
      description: "Search tracked files with a regular expression (git grep -nE). Returns path:line:text.",
      parameters: {
        type: "object",
        properties: { pattern: { type: "string" }, path: { type: "string", description: "Limit to this directory or file" } },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "git",
      description: "Run a read-only git command: diff, log, show or blame. Pass the arguments after `git`, e.g. [\"diff\", \"abc123\", \"HEAD\", \"--\", \"src/a.ts\"].",
      parameters: {
        type: "object",
        properties: { args: { type: "array", items: { type: "string" } } },
        required: ["args"],
      },
    },
  },
] as const;

const MAX_OUT = 60_000;
const clip = (s: string) => (s.length > MAX_OUT ? `${s.slice(0, MAX_OUT)}\n… (output cut at ${MAX_OUT} characters)` : s);

function inside(root: string, p: string | undefined): string {
  const real = fs.realpathSync(root);
  const target = path.resolve(real, p || ".");
  let resolved = target;
  try {
    resolved = fs.realpathSync(target);
  } catch {
    // Resolve the nearest existing ancestor too: a missing file below a symlink
    // must not bypass repository containment when creating files.
    let ancestor = path.dirname(target);
    while (!fs.existsSync(ancestor) && ancestor !== path.dirname(ancestor)) ancestor = path.dirname(ancestor);
    resolved = path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, target));
  }
  if (resolved !== real && !resolved.startsWith(real + path.sep)) throw new Error(`${p} is outside the repository`);
  if (resolved.split(path.sep).includes(".git")) throw new Error("The .git directory is off limits");
  return resolved;
}

function gitOut(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile("git", ["--no-pager", ...args], { cwd, maxBuffer: 16 * 1024 * 1024, timeout: 30_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_EXTERNAL_DIFF: "" } }, (err, stdout, stderr) => {
      if (err && !stdout) resolve(`error: ${(stderr || err.message).trim()}`);
      else resolve(stdout || "(no output)");
    });
  });
}

const GIT_ALLOWED = new Set(["diff", "log", "show", "blame"]);
const GIT_BANNED = /^(--no-index|--output|--ext-diff|--textconv|-o$|--exec|--upload-pack|-c$|--config)/;

export async function runTool(cwd: string, name: string, rawArgs: string): Promise<{ detail: string; output: string }> {
  let a: Record<string, unknown> = {};
  try {
    a = rawArgs ? (JSON.parse(rawArgs) as Record<string, unknown>) : {};
  } catch {
    return { detail: rawArgs.slice(0, 120), output: "error: arguments weren't valid JSON" };
  }
  const str = (k: string) => (typeof a[k] === "string" ? (a[k] as string) : undefined);
  try {
    switch (name) {
      case "write_file":
      case "edit_file": {
        if (!str("path")) throw new Error("path is required");
        const p = inside(cwd, str("path"));
        let content = str("content");
        if (name === "edit_file") {
          const oldText = str("old_text");
          const newText = str("new_text");
          if (!oldText || newText === undefined) throw new Error("old_text and new_text are required");
          const original = fs.readFileSync(p, "utf8");
          const first = original.indexOf(oldText);
          if (first < 0 || original.indexOf(oldText, first + 1) >= 0) throw new Error("old_text must match exactly once");
          content = original.slice(0, first) + newText + original.slice(first + oldText.length);
        }
        if (content === undefined) throw new Error("content is required");
        if (Buffer.byteLength(content) > 1024 * 1024) throw new Error("File content exceeds 1 MB");
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, content, "utf8");
        return { detail: str("path")!, output: `Saved ${str("path")} in the local review checkout.` };
      }
      case "read_file": {
        const p = inside(cwd, str("path"));
        const lines = fs.readFileSync(p, "utf8").split("\n");
        const start = Math.max(1, Number(a.start_line) || 1);
        const end = Math.min(lines.length, Number(a.end_line) || start + 1999);
        const body = lines.slice(start - 1, end).map((l, i) => `${start + i}\t${l}`).join("\n");
        return { detail: `${str("path")}${a.start_line ? `:${start}-${end}` : ""}`, output: clip(body + (end < lines.length ? `\n… (${lines.length} lines in total)` : "")) };
      }
      case "list_files": {
        const p = inside(cwd, str("path"));
        const out = await gitOut(cwd, ["ls-files", "--", path.relative(cwd, p) || "."]);
        const files = out.split("\n").filter(Boolean);
        return { detail: str("path") ?? ".", output: files.slice(0, 1000).join("\n") + (files.length > 1000 ? `\n… ${files.length} files in total` : "") };
      }
      case "search": {
        const pattern = str("pattern") ?? "";
        const p = inside(cwd, str("path"));
        const out = await gitOut(cwd, ["grep", "-n", "-I", "-E", "-e", pattern, "--", path.relative(cwd, p) || "."]);
        const lines = out.split("\n");
        return { detail: pattern, output: lines.slice(0, 300).join("\n") + (lines.length > 300 ? `\n… ${lines.length} matches in total` : "") };
      }
      case "git": {
        const args = Array.isArray(a.args) ? (a.args as unknown[]).map(String) : [];
        if (!GIT_ALLOWED.has(args[0])) return { detail: args.join(" "), output: "error: only diff, log, show and blame are allowed" };
        if (args.some((x) => GIT_BANNED.test(x))) return { detail: args.join(" "), output: "error: that option isn't allowed" };
        const safe = args[0] === "blame" ? args : [args[0], "--no-ext-diff", "--no-textconv", ...args.slice(1)];
        return { detail: `git ${args.join(" ")}`, output: clip(await gitOut(cwd, safe)) };
      }
      default:
        return { detail: "", output: `error: unknown tool ${name}` };
    }
  } catch (e) {
    return { detail: str("path") ?? "", output: `error: ${(e as Error).message}` };
  }
}

/** Ticket agents share provider settings but can also run build/test/GitHub commands. */
export const ticketTools = [
  ...TOOL_SPECS.map(tool => ({ ...tool, function: { ...tool.function, parameters: { ...tool.function.parameters, properties: { ...tool.function.parameters.properties, repository: { type: "string", description: "Repository ID from the ticket's checkout list" } } } } })),
  { type: "function", function: { name: "run_command", description: "Run a build, test, or git/gh command in a prepared ticket checkout. Supply executable and arguments separately, never a shell expression. Commit/push/create PR only when the user requests it; never force-push, deploy or merge.", parameters: { type: "object", properties: { repository: { type: "string" }, command: { type: "string" }, args: { type: "array", items: { type: "string" } } }, required: ["repository", "command", "args"] } } },
];
export async function runTicketTool(checkouts: { repositoryId: string; path: string }[], name: string, rawArgs: string, signal: AbortSignal): Promise<{ detail: string; output: string }> {
  try {
    const a = JSON.parse(rawArgs) as { repository?: string; command?: string; args?: string[] };
    const checkout = a.repository ? checkouts.find(c => c.repositoryId === a.repository) : checkouts[0];
    if (!checkout) throw new Error("Unknown ticket repository.");
    if (name !== "run_command") return runTool(checkout.path, name, rawArgs);
    if (!a.command || !Array.isArray(a.args) || a.args.some(v => typeof v !== "string")) throw new Error("Supply a command and string arguments.");
    const command = a.command;
    const args = a.args;
    return await new Promise(resolve => {
      execFile(command, args, { cwd: checkout.path, signal, timeout: 120000, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1" } }, (error, stdout, stderr) => {
        resolve({ detail: `${checkout.repositoryId}: ${command} ${args.join(" ")}`, output: clip(`${stdout}\n${stderr}${error ? `\nCommand failed: ${error.message}` : ""}`) });
      });
    });
  } catch (e) { return { detail: name, output: `error: ${(e as Error).message}` }; }
}
