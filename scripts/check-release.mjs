#!/usr/bin/env node
// Validates the release archive: unpacks it into a temp dir, scans for
// secrets/private data, installs, and runs the test suite from the packaged
// tree. Exits non-zero on any finding.
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = path.resolve(new URL('..', import.meta.url).pathname);
const distDir = path.join(root, 'dist');
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const archive = path.join(distDir, `gantry-${pkg.version}.tar.gz`);

const failures = [];
const note = (message) => console.log(`  ${message}`);

// 1. Archive exists.
await fs.access(archive);
console.log(`✓ archive exists: ${path.basename(archive)}`);

// 2. Unpack to a temp dir.
const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gantry-release-'));
await run('tar', ['-xzf', archive, '-C', workDir]);
const tree = path.join(workDir, `gantry-${pkg.version}`);
console.log(`✓ unpacked to ${workDir}`);

// 3. Content scan: secrets, credentials, private paths, user data.
const SECRET_PATTERNS = [
  [/BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/, 'private key material'],
  [/sk-[A-Za-z0-9]{20,}/, 'API key literal'],
  [/AIza[0-9A-Za-z_-]{30,}/, 'Google API key literal'],
  [/AAAA[A-Za-z0-9+/=]{40,}/, 'AWS secret key literal'],
  [/(password|passwd|secret|token)\s*[:=]\s*["'][^"']{8,}["']/i, 'hardcoded credential'],
];
const PATH_PATTERNS = [
  [/\/Users\/[a-z]/, 'macOS home path'],
  [/\/home\/[a-z]/, 'Linux home path'],
  [/C:\\\\Users\\\\/, 'Windows home path'],
  [/chetami/i, 'private workspace name'],
  [/papersetter-branch-manager/, 'private export name'],
];
// Files allowed to mention "Paper Setter" (the legacy preset label + docs).
const PAPER_SETTER_ALLOWED = /(paper-setter-legacy|README|CHANGELOG|migration|FAQ|examples|engine|architecture|configuration|migrating|agents|importer|prompt|legacy|claude|codex|adapters|check-release)/i;

let files = 0;
async function scan(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await scan(full);
      continue;
    }
    if (entry.name === 'package-lock.json' || entry.name.endsWith('.png') || entry.name.endsWith('.ico')) continue;
    files += 1;
    const content = await fs.readFile(full, 'utf8').catch(() => null);
    if (content === null) continue;
    const rel = path.relative(tree, full);
    for (const [pattern, label] of SECRET_PATTERNS) {
      if (pattern.test(content)) failures.push(`${rel}: possible ${label}`);
    }
    for (const [pattern, label] of PATH_PATTERNS) {
      if (pattern.test(content)) {
        if (label === 'private workspace name' && PAPER_SETTER_ALLOWED.test(rel)) continue;
        // This script carries its own detection sentinels.
        if (rel === 'scripts/check-release.mjs') continue;
        failures.push(`${rel}: ${label}`);
      }
    }
  }
}
await scan(tree);
console.log(`✓ scanned ${files} files for secrets and private paths`);
if (failures.length) {
  for (const failure of failures) note(`✗ ${failure}`);
  process.exit(1);
}

// 4. The packaged tree installs and its tests pass.
console.log('Installing from the packaged tree…');
process.chdir(tree);
await run('npm', ['install', '--no-audit', '--no-fund'], { cwd: tree, timeout: 300_000 });
console.log('Running tests from the packaged tree…');
await run('npx', ['vitest', 'run'], { cwd: tree, timeout: 600_000 });
console.log('✓ tests pass from the packaged tree');

await fs.rm(workDir, { recursive: true, force: true });
console.log('\nRelease archive validated.');
