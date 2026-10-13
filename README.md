# Gantry

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522.5-blue)](./package.json)

Gantry is a local development control plane: you register a Git workspace, describe its repositories and services in one `gantry.yaml`, and Gantry turns a ticket into a coordinated set of Git worktrees, an isolated local preview per branch, an AI coding agent started with a fully rendered prompt, and a review surface for pull requests and test evidence — all on your own machine, on loopback, with your own credentials.

```text
                  gantry.yaml (repositories, services, environments)
                                       |
                                       v
  +----------+   +-----------+   +---------------+   +----------+   +---------+
  |  Ticket  |-->| Worktrees |-->|    Preview    |-->|  Agent   |-->| Takeover|
  |  board   |   | (one per  |   | (per branch,  |   | (codex / |   | (open a |
  |          |   |  repo)    |   |  own ports)   |   | claude…) |   | session)|
  +----------+   +-----------+   +---------------+   +----------+   +----+----+
                                       ^                                   |
                                       |                                   v
                              +--------+--------+              +---------------------+
                              | Discovery loop  |              | PR / evidence review|
                              | (git worktree   |              | (merge evidence,    |
                              |  list + health) |              |  traces, videos)    |
                              +-----------------+              +---------------------+
```

## Why

Multi-repository changes are usually coordinated by hand: create three branches, create three worktrees, remember which port each dev server uses, start them in the right order, paste the right context into an AI agent, then chase the agent's terminal when you want to take over. Gantry makes that loop a single flow:

1. **Ticket** — a card with a title, notes, and a scope; the branch name is derived and validated against Git's ref rules.
2. **Coordinated worktrees** — one worktree per worktree-enabled repository, under `<workspace>/.worktrees/<branch-with-dashes>/`, reused when they already exist.
3. **Isolated preview** — services start in dependency order on sticky loopback ports, with a banner injected so you always know which branch a browser tab is showing.
4. **Agent** — Codex, Claude Code, OpenCode, or any command, launched detached with a rendered prompt, instruction files, and a private evidence directory.
5. **Takeover** — interrupt the background run after verifying process ownership, then resume the same session in the app or a terminal.
6. **PR / evidence loop** — merge evidence (fast-forward, squash, rebase, nested squash) retires finished previews and moves tickets to Done; Playwright traces, videos and screenshots stay local and are served sandboxed.

## Quick start

Requires Node.js >= 22.5 (`node:sqlite` is used for storage, so there is no native build step).

```sh
npm install
npm run build

# scaffold a starter config in a workspace that holds your repositories
gantry init /path/to/workspace

# register the workspace with your Gantry data directory
gantry add /path/to/workspace

# start the dashboard
gantry serve
```

Then open <http://127.0.0.1:4500>. Useful extras:

```sh
gantry status                # previews and their service states
gantry open <branch>         # open a branch preview in a browser
gantry import-legacy /path/to/workspace --dry-run
```

For development: `npm run dev:server` (tsx watch) and `npm run dev:ui` (Vite), tests with `npx vitest run`.

## Configuration at a glance

`gantry.yaml` lives at the workspace root and is reloaded on every discovery pass — edits apply without a restart. Secrets never live in this file; environments reference private env files by path.

```yaml
apiVersion: gantry.dev/v1

project:
  id: my-project
  name: My Project
  defaultAgent: codex
  defaultPromptTemplate: builtin:default
  branchPrefix: ticket
  worktreeRoot: .worktrees
  portBase: 5200

repositories:
  - id: frontend
    path: frontend
    defaultBranch: main
  - id: backend
    path: backend
    defaultBranch: main

services:
  - id: frontend
    repository: frontend
    runtime: command
    install: npm ci --no-audit --no-fund
    start: npm run dev -- --host 127.0.0.1 --port ${port}
    healthUrl: http://127.0.0.1:${port}/
    openUrl: http://127.0.0.1:${port}/
    dependsOn: [backend]
    envFiles: [.env, .env.local]
  - id: backend
    repository: backend
    runtime: command
    install: npm ci --no-audit --no-fund
    start: npm run dev
    envFiles: [.env, .env.local]

environments:
  - id: staging
    label: Staging
    default: true
    envFiles:
      frontend: .local/environments/staging/frontend.env   # private, never committed
      backend: .local/environments/staging/backend.env
```

See [docs/configuration.md](./docs/configuration.md) for every key, and [examples/](./examples) for complete workspaces.

## Agent adapters

| Adapter   | Start                         | Session id                 | Resume                          | Takeover                          |
| --------- | ----------------------------- | -------------------------- | ------------------------------- | --------------------------------- |
| `codex`   | `codex exec --json …`         | Parsed from JSON events    | Deep link (`codex://threads/…`) | Yes — interrupt the process group |
| `claude`  | `claude -p --output-format stream-json --permission-mode …` | Parsed from JSON events | Terminal (`claude --resume …`)  | Yes — interrupt the process group |
| `opencode`| `opencode run …`              | Regex on output (best effort) | Terminal (`--session …`)     | Yes — interrupt the process group |
| `generic` | Your command template (`${prompt}`) | None reported        | Not supported (reported honestly) | Process-group stop only       |

Details and how to add your own adapter: [docs/agents.md](./docs/agents.md).

## Security summary

Gantry drives Git, shells, browsers and coding agents, so exposure is the threat model.

- **Loopback by default.** The dashboard binds to `127.0.0.1:4500`; setting `GANTRY_HOST` to anything else prints a loud warning.
- **Host allowlist.** `Host` headers are matched against loopback forms only, which defeats DNS rebinding.
- **Same-origin mutations.** Every non-GET request must be same-origin JSON (`Origin` must match `Host`, `Sec-Fetch-Site` must not be `cross-site`).
- **Strict CSP and sandboxed artifacts.** `default-src 'self'` for the dashboard; only an allowlist of five artifact filenames is ever served, with `sandbox` and `frame-ancestors 'none'`.
- **Path guards.** Config- and URL-derived paths go through `validateManagedPath` / `safeJoin` and cannot escape the workspace.
- **Verified ownership before any signal.** A recorded pid is re-checked (pgid + command claim via `ps`) before Gantry ever sends it a signal.
- **Secrets stay private.** Env values live in files you never commit; the API reports key names and lengths only (`redactEnv`).
- **Archive, not delete.** Previews are archived; Gantry never deletes worktrees or discards changes.

More detail, including the threat model and explicit non-goals: [docs/security.md](./docs/security.md).

## Provenance

Gantry is a hard rewrite of a private, single-workspace "preview manager" that ran daily for a long time. The architecture is generalized (N repositories, M services, K environments, multiple projects) and the accumulated logic is preserved: preview grouping rules, merge-evidence patch verification, the Paper Setter prompt preset, and the `TEST_`-prefixed-record safety policy. `gantry import-legacy` migrates an existing legacy workspace — see [docs/migrating-from-legacy.md](./docs/migrating-from-legacy.md).

## License

[MIT](./LICENSE) — copyright 2026 Gantry contributors.
