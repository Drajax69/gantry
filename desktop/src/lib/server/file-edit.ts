import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { httpError } from "./http";

const MAX_BYTES = 2_000_000;
const revision = (text: string) => createHash("sha256").update(text).digest("hex");

async function location(root: string, relative: string) {
  const parts = relative.split("/");
  if (!relative || path.isAbsolute(relative) || parts.some(p => !p || p === "." || p === ".." || p.toLowerCase() === ".git") || relative.includes("\\") || relative.includes("\0")) {
    throw httpError(400, "Choose a file inside the review checkout.");
  }
  let file = root;
  for (const part of parts) {
    file = path.join(file, part);
    const stat = await fs.lstat(file).catch(() => null);
    if (!stat) throw httpError(404, "This file no longer exists in the local checkout.");
    if (stat.isSymbolicLink()) throw httpError(400, "Symbolic links cannot be edited here.");
  }
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.nlink !== 1) throw httpError(400, "Only regular files can be edited here.");
  if (stat.size > MAX_BYTES) throw httpError(400, "This file is too large to edit here.");
  return file;
}

export async function readEditableFile(root: string, relative: string) {
  const file = await location(root, relative);
  const bytes = await fs.readFile(file);
  const text = bytes.toString("utf8");
  if (text.includes("\0") || !Buffer.from(text).equals(bytes)) throw httpError(400, "Only UTF-8 text files can be edited here.");
  return { text, revision: revision(text) };
}

/** Called under the repository lock; never stages, commits, or pushes. */
export async function saveEditableFile(root: string, relative: string, text: string, expected: string) {
  if (Buffer.byteLength(text) > MAX_BYTES || text.includes("\0")) throw httpError(400, "Enter a text file smaller than 2 MB.");
  const current = await readEditableFile(root, relative);
  if (current.revision !== expected) throw httpError(409, "This file changed on disk. Your draft is preserved. Copy it before reopening the latest file.");
  const file = await location(root, relative);
  await fs.writeFile(file, text, "utf8");
  return { text, revision: revision(text) };
}
