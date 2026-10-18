import "server-only";
import { gh, withLock } from "./exec";
import { getTarget } from "./targets";
import { localChanges } from "./local-changes";
import { pendingFor, queuedFor } from "./chats";
import { httpError } from "./http";

export async function mergePull(id: string, head: string, method: string) {
  if (!/^[\w-]+\/[\w.-]+\/pull\/[1-9]\d*$/.test(id) || id.split("/").some(part => part === "." || part === "..") || !/^[a-f0-9]{40}$/.test(head) || !["merge", "squash", "rebase"].includes(method)) {
    throw httpError(400, "Invalid merge request.");
  }
  const target = await getTarget(id);
  return withLock(target.repoDir, async () => {
    if (pendingFor(id) || queuedFor(id).length) throw httpError(409, "Wait for the agent to finish before merging.");
    if (target.info.headSha !== head) throw httpError(409, "The PR changed. Fetch latest and review it again.");
    const local = await localChanges(id);
    if (local.files.length || local.commits) throw httpError(409, "Commit and push local changes before merging.");
    const [owner, repo, , number] = id.split("/");
    const endpoint = `repos/${owner}/${repo}/pulls/${number}`;
    const pr = JSON.parse(await gh("api", endpoint));
    if (pr.head.sha !== head) throw httpError(409, "The PR changed. Fetch latest and review it again.");
    if (!pr.merged) {
      if (pr.state !== "open" || pr.draft) throw httpError(409, "Only an open, ready-for-review PR can be merged.");
      // GitHub enforces branch protection and atomically checks the reviewed SHA.
      // The REST endpoint never silently queues an auto-merge.
      const result = JSON.parse(await gh("api", "--method", "PUT", `${endpoint}/merge`, "-f", `sha=${head}`, "-f", `merge_method=${method}`));
      if (!result.merged) throw httpError(409, result.message || "GitHub did not merge this PR.");
    }
    let warning: string | null = null;
    try {
      const upstream = new URL(process.env.PR_LENS_GANTRY_URL || "http://127.0.0.1:4500");
      if (upstream.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(upstream.hostname) || upstream.username || upstream.password) throw new Error("Invalid Gantry URL");
      const response = await fetch(new URL("/api/pulls/reconcile", upstream), {
        method: "POST", headers: { "Content-Type": "application/json", Origin: upstream.origin }, body: "{}",
        redirect: "error", signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error("Reconciliation unavailable");
    } catch {
      warning = "PR merged. Ticket status will update when Gantry next syncs with GitHub.";
    }
    return { merged: true, warning };
  });
}
