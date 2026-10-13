# Security policy

## Supported versions

Only the latest release receives security fixes. Because Gantry is a local tool that runs on your machine, always update to the newest tag; there are no long-term support branches.

| Version | Supported |
| ------- | --------- |
| latest  | yes       |
| older   | no        |

## Reporting a vulnerability

Please report privately — do not open a public issue.

- Preferred: GitHub **private security advisory** for this repository (Security -> Advisories -> New draft security advisory).
- Alternatively: email `security@example.invalid` with `[gantry]` in the subject. Replace this placeholder with a monitored mailbox before relying on it.

Include what you can of: the affected version or commit, a minimal reproduction, the impact you believe is reachable, and any config snippet needed to trigger it. Please do not include real secrets, real repository paths, or ticket contents — sanitize as you would in a public post.

What we ask of you:

- Give us a reasonable window to fix and release before public disclosure.
- Do not test against machines, accounts, or workspaces you do not own.
- Do not exfiltrate data; a proof of concept is enough.

## In scope

Gantry binds to loopback and runs as your user, so reports are most useful when they show a boundary being crossed. Examples:

- **Path traversal** — reading or writing outside the Gantry data directory or a workspace (artifact serving, log routes, repository paths, `worktreeRoot`, hook/env-file resolution).
- **CSRF / cross-origin control** — any way for a web page to trigger a mutation despite the host allowlist and same-origin checks (DNS rebinding, `Sec-Fetch-Site` bypass, `GANTRY_DEV_ORIGINS` misuse, HTML/form-based bypasses).
- **Secret exposure** — private environment values reaching the API, logs, prompts, exports, or error messages; env-file contents leaking through any response.
- **Process signaling** — a path by which Gantry signals a process it cannot prove it owns (stale pid reuse, claim mismatch, takeover racing a restart).
- **Marked-down protections** — CSP, `X-Content-Type-Options`, artifact sandboxing, or the artifact filename allowlist being bypassable.
- **Injection through untrusted input** — ticket titles, branch names, template variables, or config values reaching a shell, a Git argument list, or a spawned command unsafely.

## Out of scope

- Attacks that require an attacker to already run code as your user on your machine.
- Exposing the dashboard deliberately by setting `GANTRY_HOST` to a non-loopback address; the startup warning documents this, and multi-user or remote use is an explicit non-goal (see [docs/security.md](./docs/security.md)).
- Agents acting within the access you granted them (they run with your credentials by design). Prompt-injection reports are welcome when they show a *Gantry* control being bypassed, not merely an agent doing something you dislike.
- Missing hardening in third-party CLI agents (Codex CLI, Claude Code, OpenCode) — report those upstream.
- Denial of service against your own local instance.

## Disclosure timeline

1. **Acknowledgement** within 3 business days of the report.
2. **Triage** — impact and severity confirmed, usually within a week.
3. **Fix** developed privately, with a regression test.
4. **Release** — patched version published; you are credited in the changelog unless you prefer otherwise.
5. **Public disclosure** — advisory published after the release, coordinated with you. We aim for disclosure within 90 days of the original report.

If a report turns out to be out of scope, we will say so and explain why, and we will still consider it if it reveals a design weakness worth fixing.
