#!/usr/bin/env node
// Builds Gantry and produces a reproducible release archive under dist/.
// The archive contains source + runners + UI build + package metadata: no
// secrets, tickets, logs, worktrees, or machine-specific paths.
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';

const run = promisify(execFile);
const root = path.resolve(new URL('..', import.meta.url).pathname);
const outDir = path.join(root, 'dist');
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const name = `gantry-${version}`;

console.log('Building…');
await run('npm', ['run', 'build'], { cwd: root });

await fs.rm(path.join(outDir, name), { recursive: true, force: true });
await fs.mkdir(path.join(outDir, name, 'packages'), { recursive: true });

// Stage from git-tracked files only (never local state, tmp, or data dirs).
console.log('Staging git-tracked files…');
const files = (await run('git', ['ls-files'], { cwd: root })).stdout.split('\n').filter(Boolean);
for (const file of files) {
  const source = path.join(root, file);
  const target = path.join(outDir, name, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
}
// Build outputs that are not git-tracked.
for (const dir of [['packages', 'ui', 'dist'], ['packages', 'server', 'runners']]) {
  const source = path.join(root, ...dir);
  const target = path.join(outDir, name, ...dir);
  await fs.cp(source, target, { recursive: true });
}
await fs.writeFile(path.join(outDir, name, 'VERSION'), `${version}\n`);

console.log('Packing…');
process.chdir(outDir);
// Deterministic where the platform allows: GNU tar supports full
// normalization; macOS bsdtar gets a plain reproducible-enough archive
// (canonical release archives are produced by Linux CI).
const env = { ...process.env, COPYFILE_DISABLE: '1' };
try {
  await run('tar', ['--sort=name', '--owner=0', '--group=0', '--numeric-owner', '--mtime=1980-01-01T00:00:00Z', '-czf', `${name}.tar.gz`, name], { env });
} catch {
  await run('tar', ['--uid', '0', '--gid', '0', '--uname', '', '--gname', '', '-czf', `${name}.tar.gz`, name], { env });
}
const bytes = await fs.readFile(path.join(outDir, `${name}.tar.gz`));
const sha = createHash('sha256').update(bytes).digest('hex');
await fs.writeFile(path.join(outDir, `${name}.tar.gz.sha256`), `${sha}  ${name}.tar.gz\n`);
console.log(`Created dist/${name}.tar.gz (${(bytes.length / 1024 / 1024).toFixed(1)} MiB)`);
console.log(`SHA-256: ${sha}`);
