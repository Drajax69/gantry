import "server-only";
import fs from "node:fs";
import path from "node:path";
import { parseGithub, githubUrlForId } from "@/lib/github-url";
import type { TargetInfo } from "@/lib/types";
import { prStateOf } from "@/lib/pr-state";
import { CommandError, DIRS, gh, git, gitNet, safeName, withLock } from "./exec";
import { splitDiff, type FileDiff } from "./diff";
import { httpError } from "./http";

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export interface PreparedTarget {
  info: TargetInfo;
  repoDir: string;
  worktree: string;
  description: string; // PR body / commit message, for Claude's opening context
  diff: Record<string, FileDiff>;
}

const cache: Map<string, PreparedTarget> = ((globalThis as unknown as { __lensTargets?: Map<string, PreparedTarget> }).__lensTargets ??= new Map());
const inflight: Map<string, Promise<PreparedTarget>> = ((globalThis as unknown as { __lensInflight?: Map<string, Promise<PreparedTarget>> }).__lensInflight ??= new Map());

// ---------- repo + refs ----------

function repoDirFor(owner: string, repo: string) {
  return path.join(DIRS.repos, safeName(owner), safeName(repo));
}

/** Blobless clone shared by every target in this repo. Fails clearly when you lack access. */
async function ensureRepo(owner: string, repo: string): Promise<string> {
  const dir = repoDirFor(owner, repo);
  return withLock(dir, async () => {
    if (fs.existsSync(path.join(dir, "HEAD")) || fs.existsSync(path.join(dir, ".git"))) {
      await pinGhCredentials(dir);
      return dir;
    }
    try {
      await gh("repo", "view", `${owner}/${repo}`, "--json", "name");
    } catch (e) {
      throw httpError(404, `Can't access ${owner}/${repo} with your gh login. ${(e as CommandError).stderr ?? ""}`.trim());
    }
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    await gh("repo", "clone", `${owner}/${repo}`, dir, "--", "--filter=blob:none", "--no-checkout", "--quiet");
    await pinGhCredentials(dir);
    return dir;
  });
}

/**
 * The clone is blobless, so plain `git show`/`git diff`/checkout fetch blobs on demand.
 * Pin the gh credential helper in the repo config so those lazy fetches (and git commands
 * Claude runs inside the worktree) authenticate for private repos too. The empty entry
 * resets any global helpers first.
 */
async function pinGhCredentials(dir: string) {
  const current = await git(dir, "config", "--local", "--get-all", "credential.helper").catch(() => "");
  if (current.includes("gh auth git-credential")) return;
  await git(dir, "config", "--local", "--unset-all", "credential.helper").catch(() => {});
  await git(dir, "config", "--local", "--add", "credential.helper", "");
  await git(dir, "config", "--local", "--add", "credential.helper", "!gh auth git-credential");
}

const isSha = (s: string) => /^[0-9a-f]{7,40}$/i.test(s);

/** Fetch a branch, tag or commit sha from origin and return its commit sha. */
async function fetchRef(repoDir: string, ref: string): Promise<string> {
  const local = `refs/lens/${ref.replace(/[^\w./-]/g, "_")}`;
  const attempts = isSha(ref)
    ? [[ref], [`+refs/heads/${ref}:${local}`]]
    : [[`+refs/heads/${ref}:${local}`], [`+refs/tags/${ref}:${local}`]];
  for (const spec of attempts) {
    try {
      await gitNet(repoDir, "fetch", "--quiet", "--no-tags", "origin", ...spec);
      const target = spec[0].includes(":") ? local : ref;
      return (await git(repoDir, "rev-parse", `${target}^{commit}`)).trim();
    } catch {
      /* try the next form */
    }
  }
  throw new Error(`Couldn't find "${ref}" in the remote.`);
}

/** Pick the ref out of a /tree/<ref>/<path> URL, where both ref and path may contain "/". */
async function splitRefAndPath(repoDir: string, segments: string[]): Promise<{ ref: string; file: string | null }> {
  const remote = await gitNet(repoDir, "ls-remote", "--heads", "--tags", "origin");
  const names = new Set(remote.split("\n").map((l) => l.split("\t")[1]?.replace(/^refs\/(heads|tags)\//, "")).filter(Boolean));
  for (let i = segments.length; i > 0; i--) {
    const ref = segments.slice(0, i).join("/");
    if (names.has(ref) || (i === 1 && isSha(ref))) {
      const rest = segments.slice(i).join("/");
      return { ref, file: rest || null };
    }
  }
  return { ref: segments[0], file: segments.slice(1).join("/") || null };
}

async function defaultBranch(owner: string, repo: string): Promise<string> {
  const out = await gh("repo", "view", `${owner}/${repo}`, "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name");
  return out.trim();
}

async function expandSha(owner: string, repo: string, short: string): Promise<string> {
  try {
    return (await gh("api", `repos/${owner}/${repo}/commits/${short}`, "--jq", ".sha")).trim();
  } catch {
    throw httpError(404, `Couldn't find commit ${short} in ${owner}/${repo}.`);
  }
}

// ---------- public API ----------

/** Turn any GitHub URL into a canonical target id, plus a file to open first if the URL named one. */
export async function resolveUrl(input: string): Promise<{ id: string; file: string | null }> {
  const p = parseGithub(input);
  if (!p) throw httpError(400, "That doesn't look like a GitHub URL. Try https://github.com/owner/repo/pull/123");
  const base = `${p.owner}/${p.repo}`;
  switch (p.kind) {
    case "pull":
      return { id: `${base}/pull/${p.number}`, file: null };
    case "compare":
      return { id: `${base}/compare/${p.base}...${p.head}`, file: null };
    case "commit": {
      const repoDir = await ensureRepo(p.owner, p.repo);
      // Remotes only serve full shas, so expand an abbreviated one through the API first.
      const full = p.sha.length === 40 ? p.sha : await expandSha(p.owner, p.repo, p.sha);
      const sha = await withLock(repoDir, () => fetchRef(repoDir, full));
      return { id: `${base}/commit/${sha}`, file: null };
    }
    case "repo":
      await ensureRepo(p.owner, p.repo);
      return { id: `${base}/tree/${await defaultBranch(p.owner, p.repo)}`, file: null };
    case "tree": {
      const repoDir = await ensureRepo(p.owner, p.repo);
      const { ref, file } = await splitRefAndPath(repoDir, p.segments);
      return { id: `${base}/tree/${ref}`, file };
    }
  }
}

export function getTarget(id: string, refresh = false): Promise<PreparedTarget> {
  const cached = cache.get(id);
  if (cached && !refresh) return Promise.resolve(cached);
  const existing = inflight.get(id);
  if (existing) return existing;
  const p = prepare(id)
    .then((t) => (cache.set(id, t), t))
    .finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}

async function prepare(id: string): Promise<PreparedTarget> {
  const [owner, repo, kind, ...rest] = id.split("/");
  if (!owner || !repo || !kind || !rest.length) throw new Error(`Bad target id: ${id}`);
  const repoDir = await ensureRepo(owner, repo);
  const nwo = `${owner}/${repo}`;

  const resolved = await withLock(repoDir, async () => {
    switch (kind) {
      case "pull": {
        const number = rest[0];
        const meta = JSON.parse(
          await gh("pr", "view", number, "-R", nwo, "--json",
            "title,body,author,state,isDraft,baseRefName,headRefName,additions,deletions").catch(() => {
            throw httpError(404, `Couldn't find pull request #${number} in ${nwo}.`);
          }),
        );
        await gitNet(repoDir, "fetch", "--quiet", "--no-tags", "origin",
          `+refs/pull/${number}/head:refs/lens/pull/${number}/head`,
          `+refs/heads/${meta.baseRefName}:refs/lens/pull/${number}/base`);
        const head = (await git(repoDir, "rev-parse", `refs/lens/pull/${number}/head`)).trim();
        const base = (await git(repoDir, "merge-base", `refs/lens/pull/${number}/base`, head)).trim();
        return {
          head, base, headBranch: meta.headRefName,
          title: meta.title,
          subtitle: `#${number} · ${meta.author?.login} · ${meta.headRefName} → ${meta.baseRefName}`,
          prState: prStateOf(meta.state, meta.isDraft),
          description: `Pull request #${number} by ${meta.author?.login}: ${meta.title}\nBranch ${meta.headRefName} into ${meta.baseRefName}.\n\n${meta.body || "(no description)"}`,
        };
      }
      case "commit": {
        const head = await fetchRef(repoDir, rest[0]);
        const base = await git(repoDir, "rev-parse", `${head}^`).then((s) => s.trim(), () => EMPTY_TREE);
        const [subject, author, ...body] = (await git(repoDir, "log", "-1", "--format=%s%n%an%n%b", head)).split("\n");
        return {
          head, base, title: subject,
          subtitle: `commit ${head.slice(0, 7)} · ${author}`,
          description: `Commit ${head} by ${author}: ${subject}\n\n${body.join("\n").trim()}`,
        };
      }
      case "compare": {
        const [baseRef, headRef] = rest.join("/").split(/\.\.\.?/);
        const baseSha = await fetchRef(repoDir, baseRef);
        const head = await fetchRef(repoDir, headRef);
        const base = (await git(repoDir, "merge-base", baseSha, head)).trim();
        return {
          head, base, title: `${baseRef}...${headRef}`, subtitle: "compare",
          description: `Comparison of ${headRef} against ${baseRef} (from their merge base).`,
        };
      }
      case "tree": {
        const ref = rest.join("/");
        const head = await fetchRef(repoDir, ref);
        return {
          head, base: null, title: `${nwo}`, subtitle: `${ref} · ${head.slice(0, 7)}`,
          description: `Browsing ${nwo} at ${ref} (${head}). No diff, the whole repository is in scope.`,
        };
      }
      default:
        throw new Error(`Unknown target kind "${kind}"`);
    }
  });

  const worktree = path.join(DIRS.worktrees, safeName(id));
  await withLock(repoDir, async () => {
    if (fs.existsSync(worktree)) {
      const currentHead = (await git(worktree, "rev-parse", "HEAD")).trim();
      if (currentHead !== resolved.head) {
        const dirty = (await git(worktree, "status", "--porcelain")).trim();
        const ahead = await git(worktree, "merge-base", "--is-ancestor", currentHead, resolved.head).then(() => false, () => true);
        // Preserve both uncommitted edits and commits that have not reached the PR.
        if (!dirty && !ahead) await git(worktree, "checkout", "--quiet", "--detach", resolved.head);
      }
    } else {
      await git(repoDir, "worktree", "prune");
      await git(repoDir, "worktree", "add", "--quiet", "--force", "--detach", worktree, resolved.head);
    }
  });

  const diff = resolved.base
    ? splitDiff(await git(repoDir, "diff", "-M", "--no-color", "--no-ext-diff", resolved.base, resolved.head))
    : {};

  return {
    info: {
      id, kind: kind as TargetInfo["kind"], owner, repo,
      title: resolved.title, subtitle: resolved.subtitle, url: githubUrlForId(id),
      ...("prState" in resolved && resolved.prState ? { prState: resolved.prState } : {}),
      headSha: resolved.head, baseSha: resolved.base,
      ...("headBranch" in resolved ? { headBranch: resolved.headBranch as string } : {}),
    },
    repoDir,
    worktree,
    description: resolved.description,
    diff,
  };
}

export async function readBlob(t: PreparedTarget, sha: string, file: string): Promise<string | null> {
  if (sha === EMPTY_TREE) return null;
  try {
    return await git(t.repoDir, "show", `${sha}:${file}`);
  } catch {
    return null;
  }
}

export async function listTree(t: PreparedTarget): Promise<string[]> {
  return (await git(t.repoDir, "ls-tree", "-r", "--name-only", t.info.headSha)).split("\n").filter(Boolean);
}
