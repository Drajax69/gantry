# Set up Gantry for this folder

Give your coding agent this guide and say:

> Set up Gantry for this folder. Follow this guide, inspect the project, and create the right gantry.yaml for it.

**Instructions for the agent:** complete the setup below in the user's target
folder. Discover what you can from the code. Ask only when a missing decision
prevents a working configuration. Do not just return a sample YAML file—write it
and validate it. Include the ready-to-run Plan → Implement → Review → Create PR
graph so the user does not have to build a workflow by hand.

## 1. Inspect the workspace

- Read existing `AGENTS.md`, `CLAUDE.md`, README files, and development instructions.
- Check Git status in every repository you will edit. Preserve existing work.
- Look for `gantry.yaml`, `gantry.yml`, or `.gantry.yaml`. Update the existing file
  rather than creating a competing one. Preserve its project ID, workflows,
  environments, and custom commands unless the requested setup requires a change.
- Identify Git repositories. A single-repository workspace uses `path: .`.
  A folder containing several repositories uses paths relative to that folder.
  Packages inside a monorepo are services, not separate Git repositories.
  Exclude dependencies, generated output, and existing worktree directories.
- Inspect package manifests, lockfiles, development scripts, environment
  templates, and server entry points. Determine install commands, start commands,
  working directories, port configuration, and actual health endpoints.
- Inspect each repository's remotes and default branch. Use local remote HEAD
  information where available; do not assume every repository uses `origin/main`.
  If there is no Git repository, explain that ticket work needs one and ask whether
  to initialize it. Do not initialize or commit silently.

The workspace root must contain every configured repository. If the requested
repositories live outside it, ask the user to choose a common parent folder.

## 2. Write the smallest useful configuration

Create `gantry.yaml` at the workspace root. IDs must be lowercase kebab-case and
unique within their collection. Choose a stable project ID from the project name.

This is a complete starting point for a single repository:

```yaml
apiVersion: gantry.dev/v1
project:
  id: my-app
  name: My App
repositories:
  - id: app
    path: .
    remote: origin
    defaultBranch: main
services: []
```

Replace the example names, remote, and branch with the discovered values.
For multiple repositories, add one entry per Git root. Use `role: tooling` and
`worktree: false` only for repositories that should not get ticket worktrees.
Do not mark a repository optional merely because its setup is unfinished.

Defaults already provide `.worktrees` for ticket checkouts, allocated preview
ports, and discovery of `AGENTS.md` / `CLAUDE.md`. Add `.worktrees/` to the owning
repository's `.gitignore` if needed, preserving existing entries.

## 3. Configure previews from the real start commands

Add a service for each long-running application that belongs in a preview.
Libraries and command-line tools can keep `services: []`.

Prefer `runtime: command` with the project's existing development command.
Match its package manager and lockfile; do not change them to fit an example.
Use an allocated `${port}`, not a fixed development port, so multiple tickets
can run together. Gantry also supplies `PORT` and `HOST=127.0.0.1` to the process;
verify that the application actually uses them or pass the supported CLI flags.

For example, **only for an npm-based Vite app with a `dev` script**, replace
`services: []` above with:

```yaml
services:
  - id: web
    repository: app
    runtime: command
    install: npm ci
    start: [npm, run, dev, --, --host, 127.0.0.1, --port, "${port}", --strictPort]
    healthUrl: http://127.0.0.1:${port}/
    openUrl: http://127.0.0.1:${port}/
```

- `repository` must reference a declared repository ID.
- `workDir` is relative to the repository checkout. Use it for monorepo apps;
  make sure installation still runs at the correct lockfile root.
- `dependsOn` names service IDs and must not contain cycles. Configure a real
  `healthUrl` for dependencies so readiness reflects a working service.
- Use `${origin.api}` or `${port.api}` to connect to a service named `api`.
  Set the environment variable the consuming app actually reads; do not invent
  variable names or assume changing a URL also configures CORS.
- `healthUrl` and `openUrl` should use `${port}` for their own service. Do not
  invent `/health` if the application has no such endpoint.
- Managed `vite`, `node`, and `python` runtimes have specific integration
  requirements. Do not select them just because the project uses that language.
  Use the [configuration reference](docs/configuration.md) before choosing one.
- Use `platform.win32` command overrides when existing shell commands require
  different Windows syntax. Prefer argument arrays for portable commands.
- Do not introduce deployment, database migration, or seed commands into startup
  hooks. Inspect whether existing development commands start background workers.

If preview support needs an application change, make the smallest appropriate
change under the target repository's instructions and verify it. If required
credentials or infrastructure are unavailable, finish the ticket configuration
and clearly identify which previews still need setup.

## 4. Keep environment files private and usable from worktrees

Never put credentials in `gantry.yaml` or include their values in your response.
Inspect environment templates for key names. Preserve existing private files.

Service `envFiles` paths are relative to **each repository checkout**, not
`workDir`. Untracked `.env` files in the main checkout are not automatically
available in new ticket worktrees. For shared local settings, reference private
files through a workspace environment instead:

```yaml
environments:
  - id: local
    label: Local
    default: true
    envFiles:
      web: .local/gantry/web.env
    requireKeys:
      web: [EXAMPLE_REQUIRED_KEY]
```

Here `web` must be an existing service. Replace the path and required keys with
the project's real ones. Environment paths are relative to the **workspace root**.
Reference existing private files where practical. If creating a template, use
placeholders and explain what the user needs to fill in. Ensure private files
are ignored by the owning Git repository. Preview processes have separate ports;
database separation requires separate database configuration.

## 5. Install the starter graph

For a new workspace, include a `workflow` with **Plan → Implement → Review →
Create PR**, a Review → Implement correction loop, and `autoStart: true`. Each
stage must have its built-in instructions, not an empty prompt. Leave provider
and model overrides unset so all stages inherit the user's provider in Settings.
Keep the node positions so the graph is readable immediately.

Gantry's **Add workspace** and `gantry init` already write this graph when they
create a new config. If you create `gantry.yaml` yourself, copy the `workflow`
section from [the starter graph](examples/starter-workflow.yaml) into it.
When fetching outside this repository, use:

https://raw.githubusercontent.com/amriteshdasgupta/gantry/main/examples/starter-workflow.yaml

Use the full prompts from that file. Adapt them only for discovered project
conventions (for example, exact test commands). Planning does not edit code;
implementation includes relevant testing; review independently checks the full
diff and sends actionable findings back; Create PR commits and publishes only
reviewed work. No stage merges or deploys. Missing prerequisites are reported
as a waiting state, not silently skipped.

If a workspace already has a graph, preserve it and its automatic-run setting.
If its config has no `workflow`, add the starter graph as part of this requested
setup. Do not replace existing custom graphs with the default.

Tell the user that moving a ticket into **In progress** starts the stages while
Gantry is open, using their configured coding provider, and that the final stage
pushes the ticket branch and opens a PR. They can customize the graph or turn off
**Run automatically** in **Workspace graph**. Do not create or start a ticket as
part of setup itself.

## 6. Validate before handing off

Check YAML syntax, required fields, unique IDs, repository paths, commands,
service references, dependencies, and environment-file paths. Confirm each
repository exists and is a Git checkout. Check all commands against the actual
scripts and entry points, not just the examples in this guide.

If a built Gantry source checkout is available, run this **from its root**,
replacing the last argument with the user's workspace path:

```sh
node --input-type=module -e 'import { loadProject } from "./packages/server/dist/projects/registry.js"; const p = await loadProject(process.argv[1]); console.log("Valid:", p.config.project.name);' "/absolute/path/to/workspace"
```

This calls Gantry's real config loader without registering the workspace or
starting services. If the compiled loader is missing, build Gantry using its
README instructions first. If the source checkout is unavailable, report that
schema validation is pending rather than claiming it passed. There is no
`gantry validate` command.

Smoke-test local preview commands when the workspace instructions allow it and
the required local dependencies are available. Stop processes you started.
Distinguish config validation from successfully running the application.

## 7. Make the next step obvious

Tell the user:

1. Which files you created or changed.
2. Which repositories and previews are configured, and what you verified.
3. Any missing credentials or concrete blockers.
4. To open Gantry, choose their coding agent in **Settings**, select **Add
   workspace**, and choose this folder. Then create a ticket and move it into
   **In progress**.

Confirm the starter graph is configured with its stage prompts and review loop.
Point to **Workspace graph** for customization; no manual stage setup is needed.

If the user wants future agents to maintain this setup, append a short Gantry
section to their existing `AGENTS.md` (or their agent's instruction file),
preserving its contents. Note the config path, service names, validation command,
and this guide's URL:

https://github.com/Drajax69/gantry/blob/main/SETUP.md

## Reference

- [Configuration options and interpolation](docs/configuration.md)
- [Example workspace](examples/minimal/gantry.yaml)
- [Authoritative schema](packages/shared/src/config/schema.ts)

When reading this guide outside the Gantry repository, resolve those links under
`https://github.com/Drajax69/gantry/blob/main/`.
