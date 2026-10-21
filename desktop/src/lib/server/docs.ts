import "server-only";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { HOME, git, withLock } from "./exec";
import { httpError } from "./http";

const exec = promisify(execFile);

/**
 * Documents that live outside git (a wiki page, a doc in a planning tool) reviewed like a PR.
 *
 * A source says how to read and write one kind of URL with two shell commands, so any service
 * works without code here: a CLI, curl, or `claude -p` with the right MCP tools. Each document is
 * mirrored into a small local git repo: every fetch commits what the service holds, and the
 * working file is the person's draft. Review shows the draft as local changes; Publish runs the
 * source's publish command and fetches again.
 */
export interface DocSource {
  id: string;
  label: string;
  /** A regular expression for the URLs this source handles. Its first group is {id}. */
  match: string;
  /** Prints the document's content to stdout. */
  fetch: string;
  /** Writes {file}'s content back. Empty when the source is read-only. */
  publish: string;
}

const SETTINGS = path.join(HOME, "doc-sources.json");
const ROOT = path.join(HOME, "docs");
export const DOC_FILE = "document.md";

/** The sources in doc-sources.json. Gantry ships none: each service is the person's own config. */
export function docSources(): DocSource[] {
  let saved: DocSource[] = [];
  try { saved = (JSON.parse(fs.readFileSync(SETTINGS, "utf8")) as { sources?: DocSource[] }).sources ?? []; } catch { /* none configured */ }
  return saved.filter((s) => s?.id && s.match && s.fetch).map((s) => ({ ...s, publish: s.publish ?? "", label: s.label || s.id }));
}

/** The source for a URL, and the {id} it captured. */
export function sourceFor(url: string): { source: DocSource; docId: string } | null {
  for (const source of docSources()) {
    try {
      const m = url.match(new RegExp(source.match));
      if (m) return { source, docId: m[1] ?? url };
    } catch { /* a bad pattern in doc-sources.json skips that source */ }
  }
  return null;
}

interface DocRecord { url: string; title: string; sourceId: string }
export const docKey = (url: string) => createHash("sha256").update(url).digest("hex").slice(0, 12);
export const docTargetId = (sourceId: string, key: string) => `~doc/${sourceId}/doc/${key}`;
const dirFor = (key: string) => path.join(ROOT, key);

/** Remembers a document so its target id can be opened later. Returns the target id. */
export function registerDoc(url: string, title: string): string | null {
  const found = sourceFor(url);
  if (!found) return null;
  const key = docKey(url);
  const record: DocRecord = { url, title, sourceId: found.source.id };
  const file = path.join(ROOT, `${key}.json`);
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (current !== JSON.stringify(record)) {
    fs.mkdirSync(ROOT, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify(record), { mode: 0o600 });
  }
  return docTargetId(found.source.id, key);
}

export function docRecord(key: string): DocRecord & { source: DocSource; docId: string; dir: string } {
  if (!/^[0-9a-f]{12}$/.test(key)) throw httpError(400, "Bad document id.");
  let record: DocRecord;
  try { record = JSON.parse(fs.readFileSync(path.join(ROOT, `${key}.json`), "utf8")); }
  catch { throw httpError(404, "Gantry doesn't know this document. Open it from its ticket's review space."); }
  const found = sourceFor(record.url);
  if (!found) throw httpError(404, `No document source handles ${record.url} any more.`);
  return { ...record, ...found, dir: dirFor(key) };
}

const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
async function run(template: string, values: Record<string, string>, label: string) {
  const command = template.replace(/\{(url|id|file|title)\}/g, (_, k: string) => quote(values[k] ?? ""));
  try {
    const { stdout } = await exec("/bin/sh", ["-c", command], { timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    const e = error as { stderr?: string; message: string };
    throw httpError(502, `${label} failed: ${(e.stderr || e.message).trim().split("\n").slice(-3).join(" ")}`);
  }
}

async function ensureRepo(dir: string) {
  if (fs.existsSync(path.join(dir, ".git"))) return;
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  await git(dir, "init", "--quiet", "--initial-branch=main");
  await git(dir, "config", "user.name", "Gantry");
  await git(dir, "config", "user.email", "gantry@localhost");
}

const isDirty = async (dir: string) => !!(await git(dir, "status", "--porcelain")).trim();

/**
 * Fetches the document and commits it when it changed. A draft in progress is never overwritten:
 * the new version becomes HEAD and the working file keeps the draft, so local changes show the
 * draft against what the service now holds.
 */
export async function fetchDoc(key: string): Promise<{ dir: string; head: string }> {
  const doc = docRecord(key);
  return withLock(doc.dir, async () => {
    await ensureRepo(doc.dir);
    const content = await run(doc.source.fetch, { url: doc.url, id: doc.docId, title: doc.title }, `Fetching from ${doc.source.label}`);
    const blob = (await execGit(doc.dir, ["hash-object", "-w", "--stdin"], content)).trim();
    const head = await git(doc.dir, "rev-parse", "--verify", "--quiet", "HEAD").then((s) => s.trim(), () => null);
    const current = head ? await git(doc.dir, "rev-parse", `${head}:${DOC_FILE}`).then((s) => s.trim(), () => null) : null;
    if (current === blob) return { dir: doc.dir, head: head! };
    const dirty = head ? await isDirty(doc.dir) : false;
    const tree = (await execGit(doc.dir, ["mktree"], `100644 blob ${blob}\t${DOC_FILE}\n`)).trim();
    const commit = (await git(doc.dir, "commit-tree", tree, ...(head ? ["-p", head] : []), "-m", `Fetched from ${doc.source.label}: ${doc.url}`)).trim();
    await git(doc.dir, "update-ref", "refs/heads/main", commit);
    if (!head) await git(doc.dir, "symbolic-ref", "HEAD", "refs/heads/main");
    // Keep a draft; otherwise show the new version.
    await git(doc.dir, "reset", "--quiet", ...(dirty ? [] : ["--hard"]), commit);
    return { dir: doc.dir, head: commit };
  });
}

async function execGit(dir: string, args: string[], input: string) {
  return new Promise<string>((resolve, reject) => {
    const child = execFile("git", ["-C", dir, ...args], { maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout));
    child.stdin?.end(input);
  });
}

/**
 * Publishes the draft that was reviewed. `tree` is the snapshot the person saw: anything edited
 * since, or a newer version on the service, stops the publish so nothing unseen is written.
 */
export async function publishDoc(key: string, tree: string, expectedHead: string) {
  const doc = docRecord(key);
  if (!doc.source.publish) throw httpError(400, `${doc.source.label} is set up read-only: its source has no publish command.`);
  const before = await fetchDoc(key);
  if (before.head !== expectedHead) throw httpError(409, `The document changed in ${doc.source.label} since you opened it. Your draft is kept; review the new version and publish again.`);
  return withLock(doc.dir, async () => {
    const file = path.join(doc.dir, DOC_FILE);
    const draft = (await execGit(doc.dir, ["hash-object", "--stdin"], fs.readFileSync(file, "utf8"))).trim();
    const seen = (await git(doc.dir, "rev-parse", `${tree}:${DOC_FILE}`).catch(() => "")).trim();
    if (draft !== seen) throw httpError(409, "The draft changed after you opened Publish. Review it and try again.");
    await run(doc.source.publish, { url: doc.url, id: doc.docId, title: doc.title, file }, `Publishing to ${doc.source.label}`);
    return { published: true as const, source: doc.source.label };
  }).then(async (result) => {
    // Read back what the service now holds, so the review shows it as the latest version.
    const after = await fetchDoc(key);
    // The service may tidy what it stores (whitespace, formatting); once published, its version is the truth.
    const tidied = await isDirty(doc.dir);
    if (tidied) await withLock(doc.dir, () => git(doc.dir, "reset", "--quiet", "--hard", after.head));
    return { ...result, commit: after.head, branch: doc.source.label, ...(tidied ? { warning: `${doc.source.label} stored a slightly different version; the review now shows it.` } : {}) };
  });
}
