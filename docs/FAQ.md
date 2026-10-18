# FAQ

## Is my data isolated between previews?

No — only processes and ports are isolated. Each preview runs its own services on its own loopback ports, from its own worktrees, but every preview still points at whatever your configuration says: a shared development database stays shared. A preview writing to the same database as your main workspace is writing to that database. That is why the banner says "Shared data", why prompt templates permit only additive records prefixed with `safety.testRecordPrefix`, and why destructive verification steps are supposed to be written to `safety.manualTestFile` instead of executed. If you want real isolation, give each environment its own database and wire that up through `environments[].envFiles`.

## Does Gantry delete worktrees?

No. Gantry archives previews: services are stopped, ports are released, and the row is retained and restorable. It never deletes a worktree, never discards uncommitted changes, and never checks a different branch into an existing worktree. Removing a ticket from the board removes the card only — the branch and its worktree stay on disk until you clean them up with `git worktree remove` yourself.

## Does Gantry run on Windows?

Windows support includes desktop packaging, native window controls, CLI shims, external conversation consoles and process-tree supervision. Build on Windows using the README instructions. PowerShell CIM verifies the recorded process and unique launch marker before `taskkill` is permitted. Use `platform.win32` overrides for shell commands that depend on POSIX tools. Native Windows lifecycle validation is still required before distributing a build.

## Can I use Gantry without GitHub?

Yes. Gantry talks to your remotes over plain Git, using whatever authentication you already have (SSH agent or credential helper). Merge evidence is computed with `git merge-base`, `git patch-id`, `git cherry` and `refs/pull/*` — no API calls. The GitHub CLI is optional and only adds exact PR state (merge status, check rollups, blockers) when `gh auth status` succeeds. Without it, previews still retire on Git evidence alone.

## Can I use it without a coding agent?

Yes. Tickets, worktrees, previews, and PR/merge tracking all work with no agent installed. Adapters are optional: if `defaultAgent`'s binary cannot be found, the dashboard reports it as unavailable and ticket start fails with a clear message — but you can still create tickets, start previews, and review evidence. To skip agents entirely, work in the worktrees Gantry creates and leave the board as your tracker.

## Can I register more than one project?

Yes. `gantry add /path/to/another-workspace` registers another workspace in the same data directory; the dashboard switches between them, and each keeps its own tickets, previews, ports, environments and prompt templates. Port ranges are per project (`portBase` / `portRange`), so overlapping ranges are safe — the allocator skips ports already handed to another preview and probes the loopback interface before allocating.

## Where does my data live, and how do I start over?

Everything Gantry owns lives outside your workspaces: `~/Library/Application Support/gantry` on macOS, `$XDG_DATA_HOME/gantry` (or `~/.local/share/gantry`) on Linux, `%APPDATA%/gantry` on Windows, overridable with `GANTRY_DATA_DIR`. Inside: `gantry.db`, `logs/`, `runs/`, `artifacts/`, `ready/`, `installs/`, `tmp/`. Stop Gantry and delete that directory for a clean slate — your repositories, worktrees and private env files are untouched.

## Why does my service keep restarting?

The supervisor restarts a service when its *signature* changes — command, port, checkout path, the mtime/size of any env file it loads, or the selected environment. A service that exits soon after starting backs off for 60 seconds instead of thrashing. Two common causes:

- **A generator rewrites an env file** (`.env.local` with a timestamp) on every boot, so the signature never stabilizes. Make the file stable, or move the varying part into the environment's `env` map.
- **Something else already listens on the port.** Fixed `port` values are rejected when occupied; otherwise allocation walks the project range.

Stop the preview, fix the cause, then restart it.

## What is the banner on preview pages?

For `runtime: vite` services with `banner.enabled`, Gantry's managed runner injects a fixed bar naming the branch the page belongs to, without modifying your checkout. It exists because branch previews look identical — the banner is how you avoid editing the wrong one. `banner.autoLogin` additionally tries a programmatic sign-in through a project-provided module (`entry`, default-exporting an async `login(credentials)`); without that module, or without `preview-login.json` in the Gantry data directory, the banner renders and nothing signs in.

## How are ports chosen, and do they change?

Allocations are sticky per (project, preview, service) and persisted, so restarting a preview keeps its URLs. A fixed `port` in the config is honoured when free. Otherwise Gantry walks from `portBase` upward within `portRange`, skipping ports recorded for other previews and probing the real loopback interface. Archiving a preview releases its ports; changing the port (or the signature) is what changes URLs.

## What happens when Gantry restarts?

Recorded services and agent runs are re-verified, not trusted: each `(pid, pgid, pid_claim)` is checked against `ps`. Managed services that are still running and verifiable are adopted; unverifiable ones are forgotten rather than signalled. Agent runs do the same — a live process is adopted, a dead one is closed out and the ticket's active run released. Interrupted jobs are re-queued with bounded attempts. Nothing is killed on trust.

## Does Gantry need network access?

Only for the slow path: bounded fetches when a brand-new branch has no local or remote ref, remote default-branch refreshes, and `ls-remote`/`gh` for merge evidence and PR state. Those live in the remote-sync loop with explicit timeouts and never run on the ticket-start path, so an offline or slow network cannot stop you from starting a ticket — local refs are used instead, and a preview whose evidence cannot be recomputed simply keeps running.

## Is `gantry.yaml` safe to commit?

Yes — that is the intent. It describes structure: repository paths, service commands, environment file *paths*. It must not contain secret values; those belong in the private files that `environments[].envFiles` points at (keep them out of version control). The importer writes generated configs with mode `0600` as a reminder, and the API never returns environment values.
