// Builds an offline fixture: a "remote" repo with a pull request ref, plus a clean PR Lens home.
// Run before the test server starts (see playwright.config.ts).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, ".tmp");
fs.rmSync(root, { recursive: true, force: true });
const work = path.join(root, "work");
const remote = path.join(root, "remote.git");
fs.mkdirSync(work, { recursive: true });
fs.mkdirSync(path.join(root, "home"), { recursive: true });

const git = (...args) => execFileSync("git", args, { cwd: work, stdio: "pipe" }).toString().trim();
const write = (f, s) => (fs.mkdirSync(path.dirname(path.join(work, f)), { recursive: true }), fs.writeFileSync(path.join(work, f), s));

git("init", "-q", "-b", "main");
git("config", "user.email", "test@example.com");
git("config", "user.name", "Test");
write("README.md", "# Fixture\n\nA repo for PR Lens tests.\n");
write("src/math.ts", "export function add(a: number, b: number) {\n  return a + b;\n}\n\nexport const ZERO = 0;\n");
write("notes.txt", "this file gets deleted\n");
write("docs/guide.md", "# Guide\n\nStep one.\nStep two.\nStep three.\n");
write("lib/bridge/clients/client.ex", "defmodule Bridge.Client do\nend\n");
git("add", "-A");
git("commit", "-qm", "Initial");
git("tag", "v1");

git("checkout", "-qb", "feature");
write("src/math.ts", "export function add(a: number, b: number) {\n  // Guard against NaN\n  if (Number.isNaN(a) || Number.isNaN(b)) throw new Error(\"NaN\");\n  return a + b;\n}\n\nexport const ZERO = 0;\n");
write("src/util.py", "def greet(name):\n    return f\"hello {name}\"\n");
fs.rmSync(path.join(work, "notes.txt"));
git("mv", "docs/guide.md", "docs/handbook.md");
git("add", "-A");
git("commit", "-qm", "Guard add against NaN");

git("clone", "-q", "--bare", work, remote);
execFileSync("git", ["-C", remote, "config", "uploadpack.allowFilter", "true"]);
execFileSync("git", ["-C", remote, "config", "uploadpack.allowAnySHA1InWant", "true"]);
execFileSync("git", ["-C", remote, "update-ref", "refs/pull/1/head", "refs/heads/feature"]);
fs.writeFileSync(path.join(root, "feature.sha"), git("rev-parse", "feature"));
console.log("e2e fixture ready at", root);
