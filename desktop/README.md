# Gantry desktop

This is the unified Electron and Next.js application. Run setup and builds from the repository root as described in [the Gantry README](../README.md).

The PR-review feature grew from the existing PR Lens implementation. Compatibility names (`pr-lens://`, `PR_LENS_*`, and `~/.pr-lens`) remain to preserve existing links and personal data; the application is Gantry.

Run `npm ci` here once. `npm run dev` starts Next.js; start the runtime separately for local development. `npm run app:build` packages the app using the parent repository as runtime source. No personal tickets or provider credentials belong in this directory.

Each workspace has a **Workspace prompt** editor in its sidebar. It edits that workspace's selected prompt into a custom template in its local `gantry.yaml`. New external Codex and Claude ticket conversations receive the rendered template as starting instructions, together with ticket details and prepared worktree paths. Opening a chat does not automatically send a model turn. Existing conversations retain their original instructions. Templates support the existing Gantry variables, including `${ticket.title}`, `${ticket.description}`, `${ticket.branch}`, `${workspace}`, `${previewUrl}`, and `${repo.<repository-id>}`; product repository paths resolve to the ticket's worktrees. Paper Setter workspaces imported from the legacy branch manager retain their selected legacy preset until edited.

The sidebar's **Previews** section embeds **Main** and each **In progress** ticket's local service page. Backlog and Done tickets are excluded. A service picker, reload control, external-browser link, and expandable service logs are available in the preview pane. Main uses each repository's configured default branch; when that branch is not checked out, Gantry prepares a separate worktree without switching the user's working branch. Main remains active while Gantry is running and cannot be paused or archived. This previews local default-branch code; it does not automatically pull or reset Git branches.
