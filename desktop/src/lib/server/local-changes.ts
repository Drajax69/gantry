import "server-only";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { git, gitNet, gh, withLock } from "./exec";
import { getTarget, type PreparedTarget } from "./targets";
import { splitDiff } from "./diff";
import { withoutPatch } from "./files";
import { httpError } from "./http";
import { pendingFor, queuedFor } from "./chats";
import { publishDoc } from "./docs";
const exec = promisify(execFile);

// Build a stable view without changing the user's staging area or working files.
export async function localTarget(t: PreparedTarget) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gantry-index-"));
  const env = { ...process.env, GIT_INDEX_FILE: path.join(dir, "index") };
  const run = async (...args: string[]) => (await exec("git", ["-C", t.worktree, ...args], { env, maxBuffer: 64 * 1024 * 1024 })).stdout.trim();
  try {
    await run("read-tree", "HEAD");
    await run("add", "--all", "--", ".");
    const tree = await run("write-tree");
    const head = (await git(t.worktree, "rev-parse", "HEAD")).trim();
    const diff = splitDiff(await git(t.repoDir, "diff", "-M", "--no-ext-diff", "--no-color", t.info.headSha, tree));
    const commits = Number((await git(t.worktree, "rev-list", "--count", `${t.info.headSha}..HEAD`)).trim());
    return { target: { ...t, info: { ...t.info, baseSha: t.info.headSha, headSha: tree }, diff }, tree, head, commits };
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
export async function localChanges(id: string) {
  const t = await getTarget(id);
  const local = await localTarget(t);
  return { revision: `${t.info.headSha}:${local.head}:${local.tree}`, tree: local.tree, head: local.head, commits: local.commits,
    files: Object.values(local.target.diff).map(withoutPatch).sort((a,b) => a.path.localeCompare(b.path)),
    branch: t.info.headBranch ?? null };
}
export async function publishChanges(id: string, tree: string, expectedHead: string, message: string) {
  const t = await getTarget(id);
  // A document goes back to its service through its source's publish command.
  if (t.info.kind === "doc") return publishDoc(id.split("/")[3], tree, expectedHead);
  if (t.info.kind !== "pull") throw httpError(400, "Publishing is available for pull requests and documents.");
  return withLock(t.repoDir, async () => {
    if (pendingFor(id) || queuedFor(id).length) throw httpError(409, "Wait for the agent to finish before publishing.");
    const meta = JSON.parse(await gh("pr", "view", id.split("/").at(-1)!, "-R", `${t.info.owner}/${t.info.repo}`, "--json", "state,headRefName,headRepository,headRepositoryOwner"));
    if (meta.state !== "OPEN") throw httpError(409, "This pull request is no longer open.");
    const owner = meta.headRepositoryOwner?.login;
    const repo = meta.headRepository?.name;
    const branch = meta.headRefName;
    if (!owner || !repo || !branch || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) throw httpError(409, "The PR's source repository is unavailable.");
    await git(t.worktree, "check-ref-format", `refs/heads/${branch}`);
    const remote = `https://github.com/${owner}/${repo}.git`;
    await gitNet(t.worktree, "fetch", "--no-tags", remote, `refs/heads/${branch}`);
    const remoteHead = (await git(t.worktree, "rev-parse", "FETCH_HEAD")).trim();
    const local = await localTarget(t);
    if (local.tree !== tree || local.head !== expectedHead) throw httpError(409, "Local changes changed since you opened this dialog. Close it and review the latest changes.");
    const ancestor = await git(t.worktree, "merge-base", "--is-ancestor", remoteHead, local.head).then(() => true, () => false);
    if (!ancestor) throw httpError(409, "The PR branch has new or conflicting commits. Integrate them in the checkout before pushing; your local changes are preserved.");
    const headTree = (await git(t.worktree, "rev-parse", "HEAD^{tree}")).trim();
    if (tree !== headTree) {
      if (!message.trim()) throw httpError(400, "Enter a commit message.");
      await git(t.worktree, "add", "--all", "--", ".");
      if ((await git(t.worktree, "write-tree")).trim() !== tree) throw httpError(409, "Files changed while preparing the commit. Review the latest changes and retry.");
      await git(t.worktree, "commit", "-m", message.trim());
    }
    const commit = (await git(t.worktree, "rev-parse", "HEAD")).trim();
    try { await gitNet(t.worktree, "push", remote, `${commit}:refs/heads/${branch}`); }
    catch (e) { throw httpError(409, `Your commit is saved locally. Push failed; retry after resolving the problem. ${(e as Error).message}`); }
    return { commit, branch };
  });
}
