# Examples

Two self-contained `gantry.yaml` files that show the shape of a Gantry workspace. They are documentation, not runnable projects — copy one next to your own repositories and edit it.

| Example | Shows |
| ------- | ----- |
| [`minimal`](./minimal/gantry.yaml) | Two repositories, two `runtime: command` services with shell start commands and `${port}` interpolation, one environment that references private env files under `.local/`. |
| [`paper-setter-legacy`](./paper-setter-legacy/gantry.yaml) | A faithful, sanitized reconstruction of what `gantry import-legacy` generates: five repositories, a Vite frontend with banner, a Node backend, two Python services, two environments backed by legacy profile files, the `builtin:paper-setter-legacy` prompt preset, `codex` branch prefix, and port base 5200. |

## Using an example

Each repository lives in its own directory inside the workspace, matching the `path` values in the config. Private env files go where the config points.

```sh
mkdir -p /path/to/workspace
cd /path/to/workspace
git clone <your-frontend-repository> frontend
git clone <your-backend-repository> backend
mkdir -p .local/environments/staging
# put your private frontend.env / backend.env under .local/environments/staging

cp /path/to/gantry/examples/minimal/gantry.yaml ./gantry.yaml   # then edit ids and paths
gantry add /path/to/workspace
gantry serve
```

## Rules the examples follow

These are enforced by the Zod schema in `packages/shared/src/config/schema.ts`, so a file that breaks them fails to load with every problem listed at once:

- `apiVersion` must be exactly `gantry.dev/v1`.
- Every `id` is lowercase kebab-case (`^[a-z][a-z0-9-]*$`).
- At least one repository is declared.
- `services[].start` is required when `runtime` is `command`; managed runtimes (`vite`, `node`, `python`) start themselves and require `entry` for `node` and `python`.
- `services[].repository`, `services[].dependsOn`, and `environments[].envFiles` keys must reference declared ids; `dependsOn` must be acyclic.
- `healthUrl` / `openUrl` must be http(s) URLs and may reference `${port}`.
- Repository paths must resolve inside the workspace, and `project.worktreeRoot` must not contain `..`.
- `banner.autoLogin` requires at least one environment.

## Rules the examples follow that are conventions, not schema

- **Secrets are referenced, never inlined.** Environment files live under `.local/` (add it to `.gitignore`) and are pointed at by path.
- **`gantry.yaml` is committed.** It describes structure, not data.
- **One repository per directory**, named the way your team names them; `path` is relative to the workspace root.
- **Ports come from the project range** unless a service genuinely needs a fixed `port`.

Validate your own copy the cheap way — a config error is reported in full before anything starts:

```sh
gantry add /path/to/workspace
```
