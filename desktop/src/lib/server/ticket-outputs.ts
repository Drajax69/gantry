import "server-only";
import type { StatusView, TicketView } from "@/lib/client/gantry";
import { parseGithub } from "@/lib/github-url";
import { git } from "./exec";
import { ticketContext } from "./ticket-chat";
import { localBase, localTargetId } from "./targets";
import { registerDoc, sourceFor } from "./docs";

/**
 * What a ticket produced besides pull requests, for its review space:
 * - local outputs: commits on the ticket branch in one of its worktrees (a plan or notes written to a
 *   local repo), reviewed like a PR. The space drops one once its repo has a PR, which shows the same commits;
 * - links: URLs in the ticket's final notes or a stage's reported deliverables (an uploaded doc, a sheet).
 *   A link a document source handles (see docs.ts) opens as a tab instead, to review, edit and publish.
 */
export interface LocalOutput {
  id: string;
  /** The worktree's GitHub repo as "owner/repo", when its origin is on GitHub. */
  github: string | null;
}
export interface TicketOutputs {
  targets: LocalOutput[];
  links: { url: string; title: string }[];
}

const STALE_MS = 20_000;
// Finding local outputs reads git in every worktree, so it runs in the background and status polls read the last answer.
type Entry = { at: number; targets: LocalOutput[]; running?: boolean };
const cache: Map<string, Entry> = ((globalThis as unknown as { __gantryLocalOutputs?: Map<string, Entry> }).__gantryLocalOutputs ??= new Map());

const URL_PATTERN = /https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/g;
const githubRepo = (remote: string) => remote.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/)?.slice(1, 3).join("/").toLowerCase() ?? null;

async function findLocalTargets(ticket: TicketView, baseBranches: Record<string, string>): Promise<LocalOutput[]> {
  const work = await ticketContext(ticket.id);
  const targets: LocalOutput[] = [];
  for (const checkout of work.checkouts) {
    const baseBranch = baseBranches[checkout.repositoryId];
    if (!baseBranch) continue;
    try {
      const head = (await git(checkout.path, "rev-parse", `refs/heads/${work.ticket.branch}^{commit}`)).trim();
      const base = await localBase(checkout.path, baseBranch, head);
      if (!base || base === head) continue;
      const github = await git(checkout.path, "remote", "get-url", "origin").then((s) => githubRepo(s.trim()), () => null);
      targets.push({ id: localTargetId(ticket.id, checkout.repositoryId, baseBranch), github });
    } catch { /* A worktree mid-change is checked again on the next pass. */ }
  }
  return targets;
}

function linksFor(ticket: TicketView, deliverables: { url: string; title: string }[]) {
  const links = new Map<string, string>();
  for (const d of deliverables) if (parseGithub(d.url)?.kind !== "pull") links.set(d.url, d.title || new URL(d.url).hostname);
  for (const url of ticket.outcome?.match(URL_PATTERN) ?? []) {
    if (parseGithub(url)?.kind === "pull" || links.has(url)) continue;
    try { links.set(url, new URL(url).hostname.replace(/^www\./, "")); } catch { /* not a URL after all */ }
  }
  return [...links].map(([url, title]) => ({ url, title }));
}

/** Each in-progress ticket's non-PR outputs. Local outputs come from the last background pass, which this refreshes when stale. */
export function ticketOutputs(status: StatusView, deliverablesOf: (ticketId: string) => { url: string; title: string }[]): Record<string, TicketOutputs> {
  const result: Record<string, TicketOutputs> = {};
  for (const ticket of status.tickets) {
    if (ticket.status !== "in_progress") continue;
    const project = status.projects.find((p) => p.id === ticket.projectId);
    if (!project) continue;
    const entry = cache.get(ticket.id) ?? { at: 0, targets: [] };
    cache.set(ticket.id, entry);
    if (!entry.running && Date.now() - entry.at > STALE_MS) {
      entry.running = true;
      const baseBranches = Object.fromEntries((project.repositories ?? []).filter((r) => r.worktree && r.defaultBranch).map((r) => [r.id, r.defaultBranch!]));
      void findLocalTargets(ticket, baseBranches)
        .then((targets) => { entry.targets = targets; }, () => {})
        .finally(() => { entry.at = Date.now(); entry.running = false; });
    }
    const links = linksFor(ticket, deliverablesOf(ticket.id));
    const docs = links.flatMap((l) => { const id = registerDoc(l.url, l.title); return id ? [{ id, github: null }] : []; });
    result[ticket.id] = { targets: [...entry.targets, ...docs], links: links.filter((l) => !sourceFor(l.url)) };
  }
  return result;
}
