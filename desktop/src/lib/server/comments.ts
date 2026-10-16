import "server-only";
import type { CommentsResponse, ReviewComment, ReviewThread } from "@/lib/types";
import { gh } from "./exec";

/** One line of `gh api --jq` output for a review comment. */
interface RawReviewComment {
  id: number;
  reply_to: number | null;
  path: string;
  line: number | null;
  start_line: number | null;
  original_line: number | null;
  original_start_line: number | null;
  side: "LEFT" | "RIGHT" | null;
  user: string;
  avatar: string | null;
  body: string;
  created_at: string;
  url: string;
}

const REVIEW_JQ =
  ".[] | {id, reply_to: .in_reply_to_id, path, line, start_line, original_line, original_start_line, side, user: .user.login, avatar: .user.avatar_url, body, created_at, url: .html_url}";
const ISSUE_JQ = ".[] | {id, user: .user.login, avatar: .user.avatar_url, body, created_at, url: .html_url}";
const REVIEWS_JQ = '.[] | select(.body != "") | {id, user: .user.login, avatar: .user.avatar_url, body, created_at: .submitted_at, url: .html_url}';

const TTL_MS = 60_000;
const cache: Map<string, { at: number; data: CommentsResponse }> = ((globalThis as unknown as { __lensComments?: Map<string, { at: number; data: CommentsResponse }> }).__lensComments ??= new Map());

const lines = <T>(out: string): T[] => out.split("\n").filter(Boolean).map((l) => JSON.parse(l) as T);

const toComment = (c: { id: number; user: string; avatar: string | null; body: string; created_at: string; url: string }): ReviewComment => ({
  id: c.id, author: c.user, ...(c.avatar ? { avatar: c.avatar } : {}), body: c.body, createdAt: c.created_at, url: c.url,
});

/** Review comments on a pull request target ("owner/repo/pull/N"), grouped into threads. */
export async function getComments(id: string, refresh = false): Promise<CommentsResponse> {
  const [owner, repo, kind, number] = id.split("/");
  if (kind !== "pull") return { threads: [], general: [] };
  const hit = cache.get(id);
  if (hit && !refresh && Date.now() - hit.at < TTL_MS) return hit.data;

  const base = `repos/${owner}/${repo}`;
  try {
    const [review, issue, reviews] = await Promise.all([
      gh("api", "--paginate", `${base}/pulls/${number}/comments`, "--jq", REVIEW_JQ),
      gh("api", "--paginate", `${base}/issues/${number}/comments`, "--jq", ISSUE_JQ),
      gh("api", "--paginate", `${base}/pulls/${number}/reviews`, "--jq", REVIEWS_JQ),
    ]);

    const raw = lines<RawReviewComment>(review);
    const byId = new Map(raw.map((c) => [c.id, c]));
    const rootOf = (c: RawReviewComment): RawReviewComment => {
      const parent = c.reply_to ? byId.get(c.reply_to) : undefined;
      return parent ? rootOf(parent) : c;
    };
    const threads = new Map<number, ReviewThread>();
    for (const c of raw) {
      const root = rootOf(c);
      let t = threads.get(root.id);
      if (!t) {
        const outdated = root.line === null;
        const end = (outdated ? root.original_line : root.line) ?? 1;
        const start = (outdated ? root.original_start_line : root.start_line) ?? end;
        t = { id: `gh-${root.id}`, file: root.path, side: root.side === "LEFT" ? "old" : "new", start, end, outdated, comments: [] };
        threads.set(root.id, t);
      }
      t.comments.push(toComment(c));
    }
    for (const t of threads.values()) t.comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    const general = [...lines<RawReviewComment>(issue), ...lines<RawReviewComment>(reviews)]
      .map(toComment)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const data = { threads: [...threads.values()], general };
    cache.set(id, { at: Date.now(), data });
    return data;
  } catch (e) {
    // Comments are a nice-to-have; the review works without them.
    return { threads: [], general: [], error: (e as Error).message };
  }
}
