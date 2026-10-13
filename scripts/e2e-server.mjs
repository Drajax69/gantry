#!/usr/bin/env node
// Boots a disposable Gantry + fixture workspace for the browser suite.
// Playwright starts this as its webServer and kills it when done.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

const root = path.resolve(new URL('..', import.meta.url).pathname);
const PORT = Number(process.env.E2E_PORT ?? 4620);
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'gantry-e2e-ws-'));
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gantry-e2e-data-'));

const gitEnv = { ...process.env, GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.invalid' };
const git = async (cwd, ...args) => {
  await promisify(execFile)('git', args, { cwd, env: gitEnv });
};
for (const name of ['frontend', 'backend']) {
  const repo = path.join(workspace, name);
  await fs.mkdir(repo, { recursive: true });
  await git(repo, 'init', '-b', 'main');
  await git(repo, 'config', 'user.name', 'T');
  await git(repo, 'config', 'user.email', 't@example.invalid');
  await fs.writeFile(path.join(repo, 'README.md'), `${name}\n`);
  await git(repo, 'add', '.');
  await git(repo, 'commit', '-m', 'init');
  await git(repo, 'remote', 'add', 'origin', repo);
  await git(repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  await git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
}
for (const name of ['frontend', 'backend']) {
  await fs.writeFile(path.join(workspace, name, 'server.mjs'), `import http from 'node:http';
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end(req.url === '/health' ? 'ok:' + process.env.PORT : 'root');
});
server.listen(Number(process.env.PORT || 0), '127.0.0.1');
`);
  // The service must exist in the committed tree: ticket worktrees start
  // from origin/main, not from untracked files in the primary checkout.
  await git(path.join(workspace, name), 'add', '.');
  await git(path.join(workspace, name), 'commit', '-m', 'server');
  await git(path.join(workspace, name), 'update-ref', 'refs/remotes/origin/main', 'HEAD');
}
await fs.writeFile(path.join(workspace, 'gantry.yaml'), `apiVersion: gantry.dev/v1
project:
  id: browser
  name: Browser Fixture
  defaultAgent: generic
  defaultPromptTemplate: builtin:default
  branchPrefix: codex
  portBase: 6300
  portRange: 100
repositories:
  - id: frontend
    path: frontend
  - id: backend
    path: backend
services:
  - id: frontend
    repository: frontend
    runtime: command
    start: node server.mjs
    healthUrl: http://127.0.0.1:\${port}/health
    dependsOn: [backend]
    envFiles: []
  - id: backend
    repository: backend
    runtime: command
    start: node server.mjs
    healthUrl: http://127.0.0.1:\${port}/health
    envFiles: []
agents:
  - id: generic
    args:
      command: node -e "setTimeout(() => {}, 60000)"
`);

const child = spawn('node', [path.join(root, 'packages/cli/bin/gantry.js'), 'serve'], {
  cwd: root,
  env: {
    ...process.env,
    GANTRY_DATA_DIR: dataDir,
    GANTRY_PORT: String(PORT),
    GANTRY_UI_DIR: path.join(root, 'packages/ui/dist'),
    GANTRY_DISCOVER_INTERVAL_MS: '1500',
    GANTRY_SERVICE_READY_TIMEOUT_MS: '20000',
  },
  stdio: ['ignore', 'inherit', 'inherit'],
});
for (let attempt = 0; attempt < 80; attempt += 1) {
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/api/version`);
    if (response.ok) break;
  } catch {
    /* not up yet */
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}
await fetch(`http://127.0.0.1:${PORT}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${PORT}` }, body: JSON.stringify({ workspace }) });

const shutdown = async () => {
  // Kill the server's process group and any generic-agent sleeps it spawned.
  try {
    const { stdout } = await run('ps', ['-axo', 'pid=,command=']);
    for (const line of stdout.split('\n')) {
      if (line.includes('setTimeout(() => {}, 60000)') && !line.includes('ps -axo')) {
        const pid = Number(line.trim().split(/\s+/)[0]);
        if (pid) {
          try {
            process.kill(-pid, 'SIGKILL');
          } catch {
            /* gone */
          }
        }
      }
    }
  } catch {
    /* best effort */
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      /* gone */
    }
  }
  await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
  await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
