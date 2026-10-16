import "server-only";
import type { ChangedFile, DiffRow, Tok } from "@/lib/types";

export interface FileDiff extends ChangedFile {
  patch: string;
}

/** Split the output of `git diff` into one entry per file, keyed by its current path. */
export function splitDiff(raw: string): Record<string, FileDiff> {
  const out: Record<string, FileDiff> = {};
  for (const chunk of raw.split(/^(?=diff --git )/m)) {
    if (!chunk.startsWith("diff --git ")) continue;
    const lines = chunk.split("\n");
    const header = lines[0].match(/^diff --git "?a\/(.*?)"? "?b\/(.*?)"?$/);
    let oldPath = header?.[1] ?? null;
    let newPath = header?.[2] ?? null;
    let status: ChangedFile["status"] = "M";
    const firstHunk = lines.findIndex((l) => l.startsWith("@@"));
    for (const l of lines.slice(1, firstHunk < 0 ? undefined : firstHunk)) {
      if (l.startsWith("new file")) status = "A";
      else if (l.startsWith("deleted file")) status = "D";
      else if (l.startsWith("rename from ")) { status = "R"; oldPath = l.slice(12); }
      else if (l.startsWith("rename to ")) newPath = l.slice(10);
    }
    const patch = firstHunk < 0 ? "" : lines.slice(firstHunk).join("\n");
    let additions = 0, deletions = 0;
    for (const l of patch.split("\n")) {
      if (l[0] === "+") additions++;
      else if (l[0] === "-") deletions++;
    }
    const path = (status === "D" ? oldPath : newPath) ?? "";
    out[path] = {
      path,
      oldPath: status === "R" || status === "D" ? oldPath : null,
      status,
      additions,
      deletions,
      binary: /^Binary files /m.test(chunk),
      patch,
    };
  }
  return out;
}

/**
 * Turn a unified patch into rows, taking highlighted tokens from the full old/new files
 * so multi-line constructs (strings, comments) highlight correctly.
 */
export function patchToRows(patch: string, oldToks: Tok[][] | null, newToks: Tok[][] | null): DiffRow[] {
  const rows: DiffRow[] = [];
  let o = 0, n = 0;
  for (const line of patch.split("\n")) {
    const h = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
    if (h) {
      o = Number(h[1]);
      n = Number(h[2]);
      rows.push({ k: "hunk", text: line, oldStart: o, newStart: n });
      continue;
    }
    const c = line[0];
    const text = line.slice(1);
    if (c === "+") rows.push({ k: "add", n, text, toks: newToks?.[n - 1] ?? [[text]] }), n++;
    else if (c === "-") rows.push({ k: "del", o, text, toks: oldToks?.[o - 1] ?? [[text]] }), o++;
    else if (c === " ") rows.push({ k: "ctx", o, n, text, toks: newToks?.[n - 1] ?? [[text]] }), o++, n++;
  }
  return rows;
}

export function addedLines(patch: string): number[] {
  const added: number[] = [];
  let n = 0;
  for (const line of patch.split("\n")) {
    const h = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (h) { n = Number(h[1]); continue; }
    if (line[0] === "+") added.push(n++);
    else if (line[0] === " ") n++;
  }
  return added;
}
