import "server-only";
import type { ChangedFile, FileResponse } from "@/lib/types";
import { addedLines, patchToRows, type FileDiff } from "./diff";
import { highlight } from "./highlight";
import { readBlob, type PreparedTarget } from "./targets";
import { httpError } from "./http";

const MAX_FILE_BYTES = 2_000_000;

export function withoutPatch(diff: FileDiff): ChangedFile {
  const { path, oldPath, status, additions, deletions, binary } = diff;
  return { path, oldPath, status, additions, deletions, binary };
}

export async function loadFile(t: PreparedTarget, filePath: string, mode: "diff" | "full"): Promise<FileResponse> {
  const changed = t.diff[filePath] ?? null;
  const file: ChangedFile | null = changed ? withoutPatch(changed) : null;

  if (changed && mode === "diff") {
    if (changed.binary) return { path: filePath, file, rows: [], lines: null, added: [] };
    const [oldText, newText] = await Promise.all([
      changed.status === "A" || !t.info.baseSha ? null : readBlob(t, t.info.baseSha, changed.oldPath ?? filePath),
      changed.status === "D" ? null : readBlob(t, t.info.headSha, filePath),
    ]);
    const tooLarge = (oldText?.length ?? 0) > MAX_FILE_BYTES || (newText?.length ?? 0) > MAX_FILE_BYTES;
    const [oldToks, newToks] = await Promise.all([
      oldText && !tooLarge ? highlight(oldText, filePath) : null,
      newText && !tooLarge ? highlight(newText, filePath) : null,
    ]);
    return { path: filePath, file, rows: patchToRows(changed.patch, oldToks, newToks), lines: null, added: [], tooLarge };
  }

  const text = changed?.status === "D" ? null : await readBlob(t, t.info.headSha, filePath);
  if (text === null && !changed) throw httpError(404, `${filePath} isn't in this ${t.info.kind === "tree" ? "branch" : "change"}.`);
  if (text === null) return { path: filePath, file, rows: null, lines: null, added: [] };
  if (text.length > MAX_FILE_BYTES) return { path: filePath, file, rows: null, lines: null, added: [], tooLarge: true };
  return {
    path: filePath,
    file,
    rows: null,
    lines: await highlight(text, filePath),
    added: changed ? addedLines(changed.patch) : [],
  };
}
