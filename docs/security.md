# Security model

Gantry drives Git, shells, browsers and coding agents. It holds your credentials implicitly (it runs as you), reads private environment files, starts processes, and can signal processes it previously started. Exposure is therefore the threat model, and the controls below are implemented in `packages/server/src/http/security.ts` and friends.

## Threat model

| Threat | Consequence without controls | Control |
| ------ | ---------------------------- | ------- |
| A malicious web page reaches the local API (CSRF, DNS rebinding) | Ticket starts, agent launches, preview control from a random website | Host allowlist + same-origin mutations + `Sec-Fetch-Site` |
| A crafted URL escapes the data directory | Reading arbitrary files as the user | Artifact allowlist + UUID-checked ticket ids + `validateManagedPath`/`safeJoin` |
| A recorded pid is reused by the OS for an unrelated process | Gantry kills someone else's process | `ownsProcess` (pgid + command claim) before every signal |
| Secrets leak through the API or prompts | Environment values exposed to anything that can read the dashboard | Secrets only in private env files; `redactEnv` at the API boundary |
| Stale state from a previous run | Signaling a process Gantry no longer owns | Ownership re-verification on startup, before takeover, before every stop |
| Evidence containing authenticated page data | Leaked session data through the dashboard | Five-file allowlist, sandboxed headers, `0700` directories |

## Controls in detail

### Loopback bind by default

The dashboard binds to `127.0.0.1:4500` (`GANTRY_PORT`, `GANTRY_HOST`). Setting `GANTRY_HOST` to anything other than `127.0.0.1` or `localhost` is allowed but prints a startup warning:

```text
GANTRY_HOST=192.168.1.10: binding beyond loopback exposes this machine's Git and agents to the network
```

There is no authentication layer, because there is no remote use case in scope: keep the loopback bind.

### Host header allowlist

Every request's `Host` header must match one of `localhost:<port>`, `127.0.0.1:<port>`, `[::1]:<port>` (or the explicitly configured non-loopback host). A page that successfully rebinds a DNS name to `127.0.0.1` presents a different `Host` header and receives `403 Local access only`.

### Same-origin JSON mutations

Every non-GET request must pass `sameOriginMutation`:

- If `Origin` is present (any browser cross-origin request sends it), it must equal `http://<host>` / `https://<host>`, or appear in `GANTRY_DEV_ORIGINS`.
- `Sec-Fetch-Site` must not be `cross-site`.
- If `Origin` is absent (curl, the CLI), the request must target a loopback host and `Sec-Fetch-Site`, when present, must be `same-origin` or `none`.

Failures return `403 Same-origin requests only`.

### Content Security Policy

API and log responses carry:

```text
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'
X-Content-Type-Options: nosniff
Cache-Control: no-store
```

Artifact responses carry a stricter policy: `default-src 'none'; frame-ancestors 'none'; sandbox`, plus an explicit `Content-Disposition` (`inline` for markdown, images and video; `attachment` for zips).

### Artifact allowlist and sandboxed serving

Ticket evidence may contain authenticated page data, so serving is allowlist-driven rather than path-driven:

```text
manual-test-needed.md   video.webm   trace.zip   final.png   summary.md
```

The route takes `<ticketId>/<file>`, requires the ticket id to match `/^[a-f0-9-]{36}$/` and the filename to be a key of the allowlist table, and then constructs the path itself. URL segments never reach the filesystem as paths. Artifact directories are created with mode `0700` inside the Gantry data directory.

### Path traversal guards

All paths that originate from configuration, tickets or URLs pass through `packages/shared/src/paths.ts`:

- `validateManagedPath(workspace, candidate)` rejects control characters and any path that resolves outside the workspace, and is applied to every repository path at load time.
- `safeJoin(parent, ...segments)` resolves and then requires the result to stay inside `parent`.
- `project.worktreeRoot` must not contain `..`.
- Log routes require ids matching `/^[\w-]+$/` before a filename is composed.

### Process ownership verification

Gantry never signals a pid it cannot prove is its own. When a process is spawned it is detached, so it becomes its own process-group leader; Gantry records `(pid, pgid, pid_claim)`, where the claim is the command text `ps` will show after `sh -c` execs into the real process. Before any signal — takeover, service stop, shutdown recovery — `ownsProcess` re-reads `ps -p <pid> -o pgid=,command=` and requires both the pgid and the claim to match.

If the check fails, the process is reported and left alone (`recorded pid … is no longer ours; leaving it alone`). This is what makes a restart safe: state from a previous Gantry process cannot cause a kill of an unrelated process that happened to reuse a pid.

`interruptProcessGroup` sends SIGTERM to the group, waits up to the grace period (default 4 s, `GANTRY_TAKEOVER_GRACE_MS`), re-verifies ownership, and only then escalates to SIGKILL.

Ownership checks are POSIX `ps`-based today; Windows uses `tasklist`-based checks in a follow-up.

### Secrets in private env files only

- `gantry.yaml` never carries secret values — only *references* to private files, which must not be committed.
- Env file contents are read server-side and handed directly to the child process; they are never rewritten, logged or returned.
- `/api/status` ends with `env: redactEnv({})`: the environment view is always empty. Elsewhere, environment state is reported as key names plus value lengths (`{"set": true, "length": 24}`), never values.
- `scrubSecrets` replaces known secret substrings in free-form log text.
- Git never prompts: `GIT_TERMINAL_PROMPT=0` and batch-mode SSH are set for every Git invocation, so Gantry only ever uses credentials you already have configured.

### Confirmation for destructive operations

Archiving a preview requires `confirm: true` in the request body — the UI dialog and the API agree. Setting an environment, pausing, restarting and restoring are non-destructive and do not require it.

### No deletion of worktrees

Gantry never deletes a worktree, never discards uncommitted changes, and never checks a different branch into an existing worktree. Previews are *archived* (services stopped, ports released, row retained and restorable). Removing a ticket removes the card; its branch and worktree stay on disk.

### Agents run with your own credentials

Agents are launched as detached children of your user, inheriting your environment and your existing CLI authentication. Gantry does not proxy, store or refresh agent credentials, and does not add scopes. What an agent can do is what you can do — which is why the prompt templates constrain behaviour (`TEST_`-prefixed records only, evidence kept local, no production mutations) instead of relying on sandboxing.

## Non-goals

- **Not multi-user.** There is no authentication, no authorization model and no per-user isolation. One operator, one machine.
- **Not a hosting product.** Previews bind to loopback with no reverse proxy, no TLS termination and no public routing. Do not expose the dashboard; do not use it to serve production traffic.
- **Not a secret manager.** Private env files stay where you keep them; Gantry does not encrypt, rotate or audit them.
- **Not a sandbox for agents.** Gantry coordinates and observes agent processes; it does not confine their filesystem or network access.
- **Not a CI system.** Merge evidence and PR checks are read from your existing Git/GitHub state, not produced by Gantry.

## Reporting

See [SECURITY.md](../SECURITY.md) for how to report a vulnerability privately.

## Desktop ticket chat

Desktop provider credentials and conversations are local files outside the repository. API keys are permission-restricted but not encrypted by an OS keychain. Content sent to an external provider leaves the device as part of that provider request.

Ticket chat intentionally allows development commands inside prepared checkouts. API-provider commands are subprocesses, not an operating-system sandbox; Claude allows development shell commands and Codex uses workspace-write with explicit checkout directories and network access. Use trusted repositories and review agent changes. Only an explicit publication request (including the Create PR button) instructs the agent to commit, push and create draft PRs. This instruction is an agent policy, not a security boundary. Review chat retains its narrower editing tools.
