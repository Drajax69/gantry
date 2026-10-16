# Gantry desktop

This is the unified Electron and Next.js application. Run setup and builds from the repository root as described in [the Gantry README](../README.md).

The PR-review feature grew from the existing PR Lens implementation. Compatibility names (`pr-lens://`, `PR_LENS_*`, and `~/.pr-lens`) remain to preserve existing links and personal data; the application is Gantry.

Run `npm ci` here once. `npm run dev` starts Next.js; start the runtime separately for local development. `npm run app:build` packages the app using the parent repository as runtime source. No personal tickets or provider credentials belong in this directory.
