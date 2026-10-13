#!/usr/bin/env node
// Creates a disposable fixture workspace with two real git repos and a
// gantry.yaml, for local validation and tests. Never touches real projects.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

const target = path.resolve(process.argv[2] ?? 'tmp/fixture-workspace');
await fs.rm(target, { recursive: true, force: true });
await fs.mkdir(target, { recursive: true });

async function git(cwd, ...args) {
  return run('git', args, { cwd, env: { ...process.env, GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid', GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid' } });
}

for (const name of ['fixture-frontend', 'fixture-backend']) {
  const repo = path.join(target, name);
  await fs.mkdir(repo, { recursive: true });
  await git(repo, 'init', '-b', 'main');
  await git(repo, 'config', 'user.name', 'Fixture');
  await git(repo, 'config', 'user.email', 'fixture@example.invalid');
  await fs.writeFile(path.join(repo, 'README.md'), `# ${name}\n`);
  await git(repo, 'add', '.');
  await git(repo, 'commit', '-m', 'initial');
  // Self-remote supplies refs/remotes/origin/main offline.
  await git(repo, 'remote', 'add', 'origin', repo);
  await git(repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  await git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
}

const servicesDir = path.join(target, 'fixture-frontend');
await fs.writeFile(path.join(servicesDir, 'server.mjs'), `import http from 'node:http';
const port = Number(process.env.PORT || 8099);
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end(req.url === '/health' ? 'frontend-ok:' + port : 'frontend:' + req.url);
});
server.listen(port, '127.0.0.1');
`);
await git(servicesDir, 'add', '.');
await git(servicesDir, 'commit', '-m', 'server');

const backendDir = path.join(target, 'fixture-backend');
await fs.writeFile(path.join(backendDir, 'server.mjs'), `import http from 'node:http';
const port = Number(process.env.PORT || 8100);
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end(req.url === '/health' ? 'backend-ok:' + port : 'backend:' + req.url);
});
server.listen(port, '127.0.0.1');
`);
await git(backendDir, 'add', '.');
await git(backendDir, 'commit', '-m', 'server');

await fs.writeFile(path.join(target, 'AGENTS.md'), '# Fixture workspace\n\nFixture instructions for agents.\n');
await fs.writeFile(path.join(target, 'gantry.yaml'), `apiVersion: gantry.dev/v1
project:
  id: fixture
  name: Fixture
  defaultAgent: codex
  defaultPromptTemplate: builtin:default
  branchPrefix: codex
  worktreeRoot: .worktrees
  portBase: 5900
  portRange: 200
repositories:
  - id: frontend
    path: fixture-frontend
    remote: origin
    defaultBranch: main
    worktree: true
    required: true
  - id: backend
    path: fixture-backend
    remote: origin
    defaultBranch: main
    worktree: true
    required: true
services:
  - id: frontend
    repository: frontend
    runtime: command
    start: node server.mjs
    healthUrl: http://127.0.0.1:\${port}/health
    openUrl: http://127.0.0.1:\${port}/
    dependsOn: [backend]
    envFiles: []
  - id: backend
    repository: backend
    runtime: command
    start: node server.mjs
    healthUrl: http://127.0.0.1:\${port}/health
    openUrl: http://127.0.0.1:\${port}/
    envFiles: []
`);

console.log(target);
