import "server-only";
import type { PreparedTarget } from "./targets";
import { git } from "./exec";
import { httpError } from "./http";

export interface TicketWorkspace {
  ticket: { id: string; title: string; description: string; branch: string; status: string; additions: string | null };
  project: { id: string; name: string; workspace: string };
  checkouts: { repositoryId: string; path: string }[];
}
export async function ticketContext(ticketId: string, prepare = false): Promise<TicketWorkspace> {
  if (!/^[\w-]+$/.test(ticketId)) throw httpError(400, "Invalid ticket.");
  const base = new URL(process.env.PR_LENS_GANTRY_URL || "http://127.0.0.1:4500");
  if (base.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)) throw httpError(500, "Invalid Gantry address.");
  const response = await fetch(new URL(`/api/tickets/${ticketId}/${prepare ? "prepare" : "workspace"}`, base), {
    method: prepare ? "POST" : "GET", headers: { "Content-Type": "application/json", Origin: base.origin },
    ...(prepare ? { body: "{}" } : {}), cache: "no-store", signal: AbortSignal.timeout(180000),
  });
  const body = await response.json();
  if (!response.ok) throw httpError(response.status, body.error || "Could not prepare this ticket.");
  return body;
}
export async function ticketTarget(ticketId: string): Promise<PreparedTarget> {
  const context = await ticketContext(ticketId, true);
  const cwd = context.checkouts[0]?.path;
  if (!cwd) throw httpError(409, "This ticket has no worktrees.");
  for (const checkout of context.checkouts) {
    if ((await git(checkout.path, "branch", "--show-current")).trim() !== context.ticket.branch) throw httpError(409, "A ticket checkout changed branches. Restore its branch before chatting.");
  }
  return {
    info: { id: `ticket/${ticketId}`, kind: "tree", owner: context.project.name, repo: context.ticket.title, title: context.ticket.title, subtitle: context.ticket.branch, url: "", headSha: (await git(cwd, "rev-parse", "HEAD")).trim(), baseSha: null },
    repoDir: cwd, worktree: cwd, diff: {}, description: context.ticket.description,
    ticket: { branch: context.ticket.branch, checkouts: context.checkouts, instructions: `Workspace instructions: ${context.project.workspace}/AGENTS.md. Ticket additions: ${context.ticket.additions || "None"}` },
  };
}
