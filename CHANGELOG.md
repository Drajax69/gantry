# Changelog

All notable changes to Gantry are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- Ship the unified Gantry desktop app with ticket dialogs, column dragging, shared provider settings and external ticket conversations, and integrated PR review.
- Detect repositories for first-run workspace setup and prepare ticket worktrees independently of any provider.
- Keep personal state out of the source repository.

### Added

- Review unpublished edits in Local changes and commit and push them to the PR directly from Gantry. Preserve local commits after failed pushes and remote refreshes.

- Open GitHub pull requests in the PR Lens desktop app directly from the Pull requests board.

### Fixed

- Wire preview services using dynamic dependency origins and ports; legacy frontend imports now connect to their own preview backend.

- Managed runtimes retain a verifiable process claim, preventing duplicate preview processes on discovery passes.

- Custom agents now accept quoted command arguments and preserve literal prompt content during substitution.
- Custom-agent takeover can stop a verified process without a session ID.
- Browser checks wait for successful run and takeover states, and fixture cleanup stops only its own agents and previews through Gantry's API.

## [0.1.0] - 2026-10-13

Initial public release. Gantry is a local development control plane: register a Git workspace, describe it once in `gantry.yaml`, and move a ticket from the board to coordinated worktrees, an isolated branch preview, an AI coding agent, takeover, and PR/evidence review.

### Added

- **Workspace configuration** — `gantry.yaml` validated by a Zod schema: project defaults, repositories, services, environments, prompt templates, scopes, agent overrides, and a safety policy. Reloaded on every discovery pass, so edits apply without a restart.
- **Ticket board** — per-project backlog / in progress / done with explicit ordering, scopes, branch derivation from titles (validated with Git's ref rules), and an atomic start lock so a ticket has exactly one active run.
- **Coordinated worktrees** — one worktree per worktree-enabled repository per ticket, created idempotently and reused when they already exist, with bounded fetches so an offline or slow remote never blocks a start.
- **Branch previews** — fast local discovery groups worktrees by branch; services start in dependency order on sticky loopback ports with per-service install stamping, signature-based restarts, readiness probes, and a managed Vite banner that names the branch in the browser.
- **Managed runtimes** — `command`, `vite` (banner + optional auto-login module), `node` (imports the checkout's entry module with `ts-node` when present), and `python` (serves a Flask app from the checkout's virtual environment).
- **Service supervision** — desired-state reconciliation with ownership verification before any signal, restart backoff, health passes, startup recovery, and platform-specific command overrides.
- **Durable job queue** — SQLite-backed jobs with dedupe keys, worker-id leases, bounded retry attempts, and phase/progress reporting in the dashboard.
- **Agent adapters** — Codex CLI (JSON events, `codex://threads` deep links), Claude Code (stream-json, terminal resume), OpenCode (best-effort session parsing), and a generic command adapter; takeover interrupts a verified process group and hands back the session.
- **Prompt engine** — layered prompts from builtin or project templates with `extends` chains, repository instruction discovery, agent notes, and per-ticket additions, all through one `${var}` interpolation engine.
- **Evidence handling** — a five-file artifact allowlist (`manual-test-needed.md`, `video.webm`, `trace.zip`, `final.png`, `summary.md`), `0700` directories, and sandboxed serving.
- **Merge evidence** — patch-id verification that retires previews and completes tickets after fast-forward, squash, rebase, and nested-squash merges, with proofs cached across offline runs; optional exact PR state when the GitHub CLI is authenticated.
- **HTTP API and dashboard** — Fastify server with loopback-only binding, host allowlist, same-origin mutations, strict CSP, and a React UI for tickets, previews, and pull requests.
- **Legacy importer** — `gantry import-legacy` migrates a legacy preview-manager workspace (config, tickets, preview preferences, prompt preset) with a dry-run mode and a JSON migration report.
- **CLI** — `gantry serve`, `add`, `init`, `import-legacy`, `status`, `open`.
- **Docs** — architecture, configuration reference, security model, migration guide, agent adapters, release process, and FAQ.

[Unreleased]: relative link reference, see the repository's compare view for `HEAD...v0.1.0`
[0.1.0]: tagged `v0.1.0` in this repository
