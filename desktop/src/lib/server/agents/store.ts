import "server-only";
import { execFile } from "../spawn";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Agent, AgentInput, AgentKind, AgentStatus, AgentsResponse } from "@/lib/types";
import { HOME } from "../exec";
import { httpError } from "../http";

/** What agents.json holds: the client-facing agent plus its API key. */
export interface StoredAgent extends Agent {
  apiKey?: string;
}

interface AgentsFile {
  agents: StoredAgent[];
  current: string;
}

const FILE = path.join(HOME, "agents.json");

export const KIND_LABEL: Record<AgentKind, string> = { claude: "Claude", codex: "Codex", openai: "Own provider" };

/** The CLI each local agent runs. Overridable for tests and odd installs. */
export const CLI: Record<"claude" | "codex", string> = {
  claude: process.env.PR_LENS_CLAUDE || "claude",
  codex: process.env.PR_LENS_CODEX || "codex",
};

const seed = (): AgentsFile => ({
  agents: [{ id: "claude", kind: "claude", name: "Claude", model: "" }],
  current: "claude",
});

function load(): AgentsFile {
  try {
    const f = JSON.parse(fs.readFileSync(FILE, "utf8")) as AgentsFile;
    if (f.agents?.length) return f;
  } catch {
    /* first run */
  }
  return seed();
}

function save(f: AgentsFile) {
  // The file can hold API keys, so keep it private to this user.
  fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(f, null, 1), { mode: 0o600 });
  fs.renameSync(`${FILE}.tmp`, FILE);
}

const view = ({ apiKey, ...a }: StoredAgent): Agent => ({ ...a, ...(a.kind === "openai" ? { hasKey: !!apiKey } : {}) });

export function getAgent(id?: string | null): StoredAgent {
  const f = load();
  const agent = f.agents.find((a) => a.id === (id || f.current)) ?? f.agents.find((a) => a.id === f.current) ?? f.agents[0];
  return agent;
}

export function findAgent(id: string): StoredAgent | undefined {
  return load().agents.find((a) => a.id === id);
}

function clean(input: AgentInput, prev?: StoredAgent): StoredAgent {
  const kind = prev?.kind ?? input.kind;
  if (!(kind in KIND_LABEL)) throw httpError(400, `Unknown agent kind "${kind}".`);
  const name = (input.name ?? prev?.name ?? "").trim() || KIND_LABEL[kind];
  const model = (input.model ?? prev?.model ?? "").trim();
  const a: StoredAgent = { id: prev?.id ?? randomUUID().slice(0, 8), kind, name, model };
  if (kind === "openai") {
    const baseUrl = (input.baseUrl ?? prev?.baseUrl ?? "").trim().replace(/\/+$/, "");
    if (!/^https?:\/\/\S+$/.test(baseUrl)) throw httpError(400, "Give the provider's base URL, like https://openrouter.ai/api/v1.");
    if (!model) throw httpError(400, "Name the model to use, like gpt-5 or llama3.1.");
    a.baseUrl = baseUrl;
    const key = input.apiKey !== undefined ? input.apiKey.trim() : prev?.apiKey;
    if (key) a.apiKey = key;
  }
  return a;
}

export async function listAgents(): Promise<AgentsResponse> {
  const f = load();
  const agents = await Promise.all(f.agents.map(async (a) => ({ ...view(a), status: await statusOf(a) })));
  return { agents, current: f.current };
}

export function addAgent(input: AgentInput, makeCurrent = true): Agent {
  const f = load();
  const a = clean(input);
  f.agents.push(a);
  if (makeCurrent) f.current = a.id;
  save(f);
  return view(a);
}

export function updateAgent(id: string, input: Partial<AgentInput>): Agent {
  const f = load();
  const i = f.agents.findIndex((a) => a.id === id);
  if (i < 0) throw httpError(404, "No such agent.");
  f.agents[i] = clean({ kind: f.agents[i].kind, ...input }, f.agents[i]);
  save(f);
  return view(f.agents[i]);
}

export function setCurrentAgent(id: string) {
  const f = load();
  if (!f.agents.some((a) => a.id === id)) throw httpError(404, "No such agent.");
  f.current = id;
  save(f);
}

export function removeAgent(id: string) {
  const f = load();
  if (f.agents.length <= 1) throw httpError(400, "Keep at least one agent.");
  f.agents = f.agents.filter((a) => a.id !== id);
  if (f.current === id) f.current = f.agents[0].id;
  save(f);
}

// --- status -------------------------------------------------------------------------------

const versions = new Map<string, { at: number; status: AgentStatus }>();

function version(cmd: string): Promise<AgentStatus> {
  const hit = versions.get(cmd);
  if (hit && Date.now() - hit.at < 60_000) return Promise.resolve(hit.status);
  return new Promise((resolve) => {
    execFile(cmd, ["--version"], { timeout: 8000 }, (err, stdout) => {
      const status: AgentStatus = err
        ? { ok: false, detail: (err as NodeJS.ErrnoException).code === "ENOENT" ? `"${cmd}" isn't installed or isn't on PATH` : `"${cmd} --version" failed` }
        : { ok: true, detail: stdout.trim().split("\n")[0] || "Installed" };
      versions.set(cmd, { at: Date.now(), status });
      resolve(status);
    });
  });
}

function statusOf(a: StoredAgent): Promise<AgentStatus> {
  if (a.kind === "openai") return Promise.resolve({ ok: true, detail: `${new URL(a.baseUrl!).host} · ${a.model}` });
  return version(CLI[a.kind]);
}

/** A live check: the CLI's version, or a request to the provider's /models. */
export async function testAgent(id: string): Promise<AgentStatus> {
  const a = findAgent(id);
  if (!a) throw httpError(404, "No such agent.");
  if (a.kind !== "openai") {
    versions.delete(CLI[a.kind]);
    return version(CLI[a.kind]);
  }
  try {
    const res = await fetch(`${a.baseUrl}/models`, {
      headers: a.apiKey ? { Authorization: `Bearer ${a.apiKey}` } : {},
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, detail: `${res.status} ${res.statusText} from ${a.baseUrl}/models` };
    const body = (await res.json().catch(() => null)) as { data?: { id: string }[] } | null;
    const ids = body?.data?.map((m) => m.id) ?? [];
    if (ids.length && !ids.includes(a.model)) return { ok: false, detail: `Connected, but "${a.model}" isn't in its model list` };
    return { ok: true, detail: `Connected to ${new URL(a.baseUrl!).host}` };
  } catch (e) {
    return { ok: false, detail: `Couldn't reach ${a.baseUrl}: ${(e as Error).message}` };
  }
}
