/**
 * Parse anything that points at GitHub into a structured request.
 * Accepts full URLs, scheme-less URLs, "owner/repo", "owner/repo#123", and our own ids.
 * Tree/blob refs are left unresolved (a branch can contain "/"), the server resolves them.
 */
export type ParsedGithub =
  | { kind: "pull"; owner: string; repo: string; number: number }
  | { kind: "commit"; owner: string; repo: string; sha: string }
  | { kind: "compare"; owner: string; repo: string; base: string; head: string }
  | { kind: "tree"; owner: string; repo: string; segments: string[] } // ref + optional path, unsplit
  | { kind: "repo"; owner: string; repo: string };

export function parseGithub(input: string): ParsedGithub | null {
  let s = input.trim();
  if (!s) return null;
  const short = s.match(/^([\w.-]+)\/([\w.-]+)#(\d+)$/);
  if (short) return { kind: "pull", owner: short[1], repo: short[2], number: Number(short[3]) };

  s = s.replace(/^https?:\/\//, "").replace(/^(www\.)?github\.com\//, "");
  s = s.split(/[?#]/)[0].replace(/\/+$/, "");
  const parts = s.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length < 2) return null;
  const [owner, rawRepo, kind, ...rest] = parts;
  const repo = rawRepo.replace(/\.git$/, "");
  // GitHub owners are letters, digits and dashes; a dot means some other host (example.com/x).
  if (!/^[A-Za-z0-9-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return null;

  switch (kind) {
    case undefined:
      return { kind: "repo", owner, repo };
    case "pull":
    case "pulls": {
      const n = Number(rest[0]);
      return Number.isInteger(n) && n > 0 ? { kind: "pull", owner, repo, number: n } : null;
    }
    case "commit":
    case "commits":
      return rest[0] && /^[0-9a-f]{4,40}$/i.test(rest[0]) ? { kind: "commit", owner, repo, sha: rest[0] } : null;
    case "compare": {
      const spec = rest.join("/");
      const m = spec.match(/^(.+?)\.\.\.?(.+)$/);
      return m ? { kind: "compare", owner, repo, base: m[1], head: m[2] } : null;
    }
    case "tree":
    case "blob":
      return rest.length ? { kind: "tree", owner, repo, segments: rest } : { kind: "repo", owner, repo };
    default:
      return { kind: "repo", owner, repo };
  }
}

export function githubUrlForId(id: string): string {
  return `https://github.com/${id}`;
}
