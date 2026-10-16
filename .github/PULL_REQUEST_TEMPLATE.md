<!--
  Thank you for the pull request. Keep it focused: one behaviour change per PR
  reviews and reverts much more easily than five.
-->

### Summary

<!-- What changes, and why? Two or three sentences. -->

### Related issues

<!-- "Fixes #123", or "Refs #456" when it does not close anything. -->

### Changes

-
-

### How it was tested

<!-- Commands run and scenarios exercised. Tests create real temp git repos,
     so `npx vitest run` is the meaningful check. -->

- [ ] `npx vitest run`
- [ ] `npm run typecheck`
- [ ] `npm run lint` (run locally)

Scenarios exercised (for supervision, jobs, and agent changes):

- [ ] Gantry restart mid-run
- [ ] Slow or absent remote
- [ ] Dirty or pre-existing worktree
- [ ] Process ownership verification on takeover

### Checklist

- [ ] Tests added or updated for the new behaviour
- [ ] Documentation updated (`docs/`, README, or configuration reference)
- [ ] `CHANGELOG.md` entry under `## [Unreleased]` for user-visible changes
- [ ] No secrets, tokens, real usernames, or absolute home paths introduced
- [ ] Reliability invariants respected (atomic start lock, durable jobs, fast/slow discovery split, ownership verification before any signal, archive-not-delete)
- [ ] New config keys added to the Zod schema with defaults and documented

### Screenshots

<!-- Only for dashboard changes. Do not attach images containing real tickets,
     repository names, or customer data. -->
