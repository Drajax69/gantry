# Release process

Gantry follows [semantic versioning](https://semver.org/): `MAJOR.MINOR.PATCH`. Breaking changes to the `gantry.dev/v1` config schema, the HTTP API, or the CLI surface are MAJOR; new features are MINOR; fixes are PATCH. The repository version lives in the root `package.json` and in each workspace package's `package.json` — keep them in lockstep with `packages/server/src/version.ts`, which is what the server reports.

The two release scripts are `scripts/pack-release.mjs` (`npm run release:pack`) and `scripts/check-release.mjs` (`npm run release:verify`).

## Cutting a release

1. **Update the changelog.** Add a `## [x.y.z] - YYYY-MM-DD` section to [CHANGELOG.md](../CHANGELOG.md) following Keep a Changelog. Do not release with a full `## [Unreleased]` section.
2. **Bump versions.** Root `package.json`, `packages/shared`, `packages/server`, `packages/cli`, `packages/ui`, and `packages/server/src/version.ts`.
3. **Pack.**

   ```sh
   npm run release:pack
   ```

   Builds everything, then stages **git-tracked files only** — so local state, `tmp/`, data directories and worktrees never get in — plus the two build outputs that are not tracked (`packages/ui/dist` and `packages/server/runners`), and a `VERSION` file. It then creates a reproducible archive (`--sort=name`, zeroed owner/group, fixed mtime) at `dist/gantry-<version>.tar.gz` and writes `dist/gantry-<version>.tar.gz.sha256` with the SHA-256.

4. **Verify.**

   ```sh
   npm run release:verify
   ```

   Exits non-zero on any finding:

   - the archive for the current version exists, unpacks, and installs
   - a content scan over every packaged file for private key material, API-key literals, hardcoded credentials, and home/private paths (`/Users/…`, `/home/…`, `C:\Users\…`, and known private workspace names — docs mentioning the legacy preset label are allowlisted)
   - the test suite passes **from the packaged tree**, not the working tree

   Never publish a release that failed `release:verify`. If the verifier flags something, fix the packaging or the content — never weaken the check.

5. **Tag and push.**

   ```sh
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```

   Tags do not trigger a pipeline. Build and verify release archives locally using the commands above.

6. **Publish the GitHub release.** Attach the archive and its `.sha256` sidecar. Verify a download with:

   ```sh
   shasum -a 256 -c gantry-<version>.tar.gz.sha256
   ```

7. **Announce.** Paste the changelog section into the release notes and link any migration notes ([migrating-from-legacy.md](./migrating-from-legacy.md)) or configuration changes ([configuration.md](./configuration.md)).

## Checklist

- [ ] `CHANGELOG.md` has a section for this version
- [ ] versions bumped in the root, all four workspace packages, and `version.ts`
- [ ] `npm run typecheck` clean
- [ ] `npx vitest run` green
- [ ] `npm run release:pack` produced `dist/gantry-<version>.tar.gz` (+ `.sha256`)
- [ ] `npm run release:verify` passed
- [ ] tag pushed, release job green
- [ ] archive and checksum published

## After a breaking change

- Document the migration path in the changelog entry, with before/after config snippets when the schema changed.
- Bump `apiVersion` in `packages/shared/src/config/schema.ts` only when old config files cannot be loaded as-is; that is a MAJOR release by definition.
- Numbered SQL migrations are append-only. Never edit an applied migration — add `packages/server/src/db/migrations/NNN_description.sql`.
