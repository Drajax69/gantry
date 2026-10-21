# Working with Gantry

## Setting up a user's workspace

When asked to “set up Gantry for this folder”, follow [SETUP.md](SETUP.md).
It covers repository discovery, writing `gantry.yaml`, preview services, private
environment files, and validation. Apply it to the user's target folder, which
may be different from this Gantry source checkout.

## Changing Gantry itself

Read [CONTRIBUTING.md](CONTRIBUTING.md) and any nearer `AGENTS.md` before editing.
Check Git status and preserve unrelated changes. Use the existing package manager
and run checks relevant to the change. The configuration schema lives in
`packages/shared/src/config/schema.ts`; the user-facing reference is
`docs/configuration.md`. Keep [SETUP.md](SETUP.md) accurate when configuration or
setup behaviour changes.
