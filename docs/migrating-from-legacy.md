# Migrating from the legacy preview manager

Gantry is a hard rewrite of a private, single-workspace preview manager. The importer reads that manager's state directory and produces a complete Gantry workspace: a generated `gantry.yaml`, ticket rows, and preview preferences.

```sh
gantry import-legacy /path/to/workspace --state-dir /path/to/workspace/.local/previews
```

`--state-dir` defaults to `<workspace>/.local/previews`, so in the common case:

```sh
gantry import-legacy /path/to/workspace             # real import
gantry import-legacy /path/to/workspace --dry-run   # validate and report, write nothing
```

The importer prints a full JSON migration report — what moved, what needs attention, what was skipped, and the exact rollback instructions. Keep it; it is the record of the migration.

```json
{
  "workspace": "/path/to/workspace",
  "configFile": "/path/to/workspace/gantry.yaml",
  "dryRun": false,
  "imported": {
    "tickets": 14,
    "ticketsWithSessions": 6,
    "previewPreferences": 9,
    "environments": ["papersetter", "xamify"],
    "repositories": ["frontend", "backend", "e2e", "logic", "document"],
    "services": ["frontend", "backend", "logic", "document"],
    "promptTemplate": "builtin:paper-setter-legacy"
  },
  "attention": ["…"],
  "skipped": ["…"],
  "rollback": "…"
}
```

## What is imported

**Repositories and services** are derived from the workspace layout. Directories are matched by known names (for example `examify`, `examify-backend`, `examify-e2e`, `examify-logic`, `examify-document-service`, with generic fallbacks such as `frontend`/`web`, `backend`/`api`, `e2e`/`tests`, `logic`, `document-service`/`document`). The frontend and backend are required `product` repositories; the E2E harness becomes optional `tooling`; logic and document services become optional `product` repositories. Services are declared with managed runtimes — Vite for the frontend (banner enabled), Node for the backend (`entry: src/app.ts`), Python for logic (`entry: app`) and document (`entry: render_api`) — with dependency order and per-repository env file lists carried over.

**Environments** are created from each directory under `profiles/`. The generated config *references* the existing private env files in place (`profiles/<id>/<service>.env`, expressed as a workspace-relative path); their contents are never read or copied. `papersetter` is marked as the default environment and labelled "Paper Setter".

**Tickets** are inserted with their title, notes, scope, status, branch, and ordering preserved. Stable ids make re-imports idempotent: the legacy ticket id when it is a valid UUID, otherwise a deterministic hash of its content. Agent session ids found in the legacy ticket chat state are carried over, so resume and deep links keep working for tickets whose sessions survived.

**Preview preferences** stick across the migration: paused and archived flags, the selected environment profile, and previously assigned ports (rows are created for every known legacy preview, including paused or removed ones that never had ports).

**Prompt preset**: `builtin:paper-setter-legacy` is selected as `project.defaultPromptTemplate` — a variable-generalized port of the original ticket prompt with identical behaviour (instruction-file discovery, commit/push/PR requirements, no automatic merging, local browser verification, additive `TEST_` records only, `manual-test-needed.md`, local evidence files).

**Project identity** is `papersetter` / "Paper Setter" with `branchPrefix: codex` and `portBase: 5200`, matching the legacy defaults. The generated file is written with mode `0600` and a header comment; if a `gantry.yaml` already exists it is left untouched and reported under `skipped`.

## What is deliberately NOT imported

| Not imported | Why |
| ------------ | --- |
| Stale service PIDs | A recorded pid is meaningless after a reboot. Gantry records ownership claims and verifies them against `ps` on startup, adopting only processes it can prove are its own. |
| Secrets | Environment files stay exactly where they are; the generated config references their paths, never their contents. `preview-login.json` is never read. |
| Evidence artifacts | Traces, videos and screenshots remain where the legacy manager wrote them. |
| Logs | Legacy logs stay in the legacy state directory. |

## What needs attention

The report's `attention` array is the checklist. Typical entries:

- **Banner auto-login module.** The frontend service is generated with `banner.autoLogin: false` and `entry: src/services/preview-login.ts`. Auto-login expects a project-provided module that default-exports an async `login(credentials)` function; the managed Vite runner imports it in the browser and calls it with the credentials from `preview-login.json`. Until that module exists, the banner renders and reports sign-in as skipped — everything else works.
- **`preview-login.json`.** If the legacy state directory contains one, the importer reports it and stops there: credentials are never read. Copying it into the Gantry data directory is optional and only matters once you enable auto-login. The file holds `{ email, password }`, lives outside any workspace with `0600` permissions, and its values are handed only to the browser bootstrap — never returned by the API or written to logs.
- **Missing E2E harness.** If no E2E directory was found, the legacy prompt still references one; add a `tooling` repository to `gantry.yaml`.
- **Legacy PIDs.** Counted and reported, never imported as running.
- **Profiles without env files.** Skipped and reported.
- **No profiles at all.** Previews will run without private environment files until you configure environments.

## Running side-by-side

The legacy manager and Gantry can run at the same time: they use different ports and different data directories.

| | Legacy manager | Gantry |
| --- | -------------- | ------ |
| Dashboard port | 4400 | 4500 (`GANTRY_PORT`) |
| State | `<workspace>/.local/previews` | Platform data directory (`GANTRY_DATA_DIR`) |
| Config | internal JSON state | `<workspace>/gantry.yaml` |

Both read the same repositories, so a worktree created by one is visible to the other — that is a feature, not a conflict. Prefer not running both supervisors against the same preview at once; stop the legacy preview before starting the Gantry one.

## Rollback

The legacy manager is never modified. To abandon the migration:

```sh
rm /path/to/workspace/gantry.yaml
rm -rf "$HOME/Library/Application Support/gantry"   # macOS; see docs/architecture.md for other platforms
```

This is the importer's own documented rollback path. Note that the data directory is global to Gantry, not per workspace — deleting it also removes tickets, runs and history for any *other* registered workspaces. To unregister just this project while keeping the rest, use `DELETE /api/projects/<projectId>` on the running dashboard instead.

Legacy state, worktrees and profiles remain untouched either way. Because generated ticket ids are stable, a later re-import produces the same rows instead of duplicates.
