# Gantry

Gantry is a local desktop workspace for taking a ticket from an idea to a pull request:

**Ticket → worktrees → feature → draft PR → review**

The Electron app combines a workspace switcher, a draggable ticket board, external coding-agent conversations, branch previews, and PR review. Each ticket opens in a large dialog with Details and Preview tabs. Related pull requests stay together in the ticket's review space.

Configure your provider once in Settings. Ticket chat and PR review use the same provider and model: Claude Code, Codex CLI, or an OpenAI-compatible API such as OpenRouter or a local model server.

## Start on macOS

You need Node.js 22.12 or newer, npm, Git, and [GitHub CLI](https://cli.github.com/) logged in with `gh auth login`. For a CLI provider, install and log in to Claude Code or Codex. API providers are configured in the app.

```sh
git clone https://github.com/Drajax69/gantry.git
cd gantry
npm ci
npm run desktop:setup
npm run desktop:start
```

To build `Gantry.app`:

```sh
npm run desktop:build
open desktop/dist/mac-arm64/Gantry.app
```

Build output depends on your Mac architecture. The app is currently unsigned; this is a source-build release, not a signed installer. The runtime also runs on Linux, but desktop packaging is currently configured for macOS.

## Use it

1. Choose a provider in **Settings**. This choice is shared throughout the app.
2. **Add workspace** using a Git repository folder or a folder containing repositories. Gantry discovers repositories and writes a local `gantry.yaml` if none exists. Existing configuration is preserved.
3. Create a ticket with a title, notes, and optional existing branch. Drag it between Backlog, In progress, and Done, or use the Stage control in Details.
4. **Open chat** creates or reuses ticket worktrees and opens a persistent conversation in the Codex app or Claude Code in Terminal. Each ticket keeps its conversation and provider when your default changes. Gantry does not embed ticket chat.
5. Ask the external agent to implement the feature, validate it, and create or update a draft PR. Gantry discovers PRs matching the ticket branch for integrated review. Opening chat does not start an agent turn or publish changes. API-only providers remain available for PR review; ticket conversations require Codex or Claude.
6. Open **Review** to see the ticket's PRs together. **Back** returns to its ticket. Finished tickets retain their history but have no visible review spaces or previews.

Existing PRs are associated by repository and exact branch name. Use that branch when creating a ticket for work already underway. Remote sync discovers PRs; its progress and errors appear in the workspace activity.

Preview services are optional. Auto-created workspaces start with no services; add commands, environment-file paths, health URLs and dependencies to `gantry.yaml` using [the configuration guide](docs/configuration.md). Service processes and ports are separated per branch; databases are not automatically isolated.

## Personal data stays on your device

This repository contains application source and synthetic test fixtures only. Tickets, conversations, API keys, repository checkouts, logs, previews, and workspace configuration are local artifacts, not source files to commit or upload here.

- Runtime state: `~/Library/Application Support/gantry` on macOS, `$XDG_DATA_HOME/gantry` or `~/.local/share/gantry` on Linux (`GANTRY_DATA_DIR` overrides it).
- Provider configuration, review spaces and chats: `~/.pr-lens` (`PR_LENS_HOME` overrides it). This legacy directory preserves data from the original review app integration.
- Desktop profile: the existing `PR Lens` application-support directory for compatibility.
- Ticket worktrees: the workspace's configured worktree directory.

Provider credentials are stored locally, not in this repo. They are currently stored in a permission-restricted JSON file, not the OS keychain. Chat requests send prompts and relevant code to the selected provider; local-only storage does not mean an external model never receives code. GitHub operations use your existing `gh` credentials.

## Agent access

External ticket conversations work in the prepared worktrees. PR review chat edits its local review checkout. Switch between **PR changes** (published on GitHub) and **Local changes** (unpublished edits and commits). Local changes refresh automatically. **Commit and push** lists all files, accepts a commit message, and publishes to the PR source branch without force-pushing. Failed pushes keep the commit for retry; refreshing preserves local work.

Coding agents execute with your local credentials and should be used on repositories you trust. They are instructed to preserve unrelated changes and not publish until requested. API-provider command execution is not an OS sandbox. Never commit secrets to a ticket branch.

## Development

- `desktop/`: Electron + Next.js application, shared provider settings, chat, review UI.
- `packages/server/`: local runtime, tickets, worktrees, previews and GitHub discovery.
- `packages/shared/`: configuration and shared models.
- `packages/cli/`: `gantry` CLI.
- `packages/ui/`: standalone browser dashboard for runtime administration.

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run desktop:setup
npm run typecheck --prefix desktop
npm run lint --prefix desktop
npx --prefix desktop playwright install chromium
npm run desktop:test
```

Browser tests use fake providers and disposable Git repositories; they do not publish real PRs. See [CONTRIBUTING.md](CONTRIBUTING.md), [security](docs/security.md), and [configuration](docs/configuration.md).
