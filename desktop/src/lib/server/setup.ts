import "server-only";
import { listAgents } from "./agents";
import { herdrStatus } from "./terminal-launcher";

export interface SetupCheck { ok: boolean; detail: string }

/**
 * What Gantry needs on this computer before chats can open: herdr, and at least one coding CLI
 * (Claude Code, OpenCode or Codex) that is installed and set up as a provider.
 */
export async function setupStatus(): Promise<{ ok: boolean; herdr: SetupCheck; agent: SetupCheck }> {
  const [herdr, { agents }] = await Promise.all([herdrStatus(), listAgents()]);
  const clis = agents.filter((a) => a.kind !== "openai");
  const ready = clis.find((a) => a.status.ok);
  const agent: SetupCheck = ready
    ? { ok: true, detail: `${ready.name}: ${ready.status.detail}` }
    : { ok: false, detail: clis.length
        ? `${clis.map((a) => a.name).join(", ")} ${clis.length === 1 ? "isn't" : "aren't"} installed. Install Claude Code or OpenCode, or add one that is in Settings.`
        : "Add Claude Code or OpenCode as a provider in Settings." };
  return { ok: herdr.ok && agent.ok, herdr, agent };
}
