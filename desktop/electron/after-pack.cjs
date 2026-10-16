// electron-builder drops dot-directories like .next from extraResources, so copy the
// standalone server into the app bundle ourselves.
const fs = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  const app = fs.readdirSync(context.appOutDir).find((f) => f.endsWith(".app"));
  const resources = app ? path.join(context.appOutDir, app, "Contents", "Resources") : path.join(context.appOutDir, "resources");
  const dest = path.join(resources, "server");
  const src = path.join(context.packager.projectDir, ".next", "standalone");
  fs.rmSync(dest, { recursive: true, force: true });
  // Next traces the whole project into standalone; leave out what the app never reads.
  const skip = new Set([".git", "e2e", "dist", "test-results", "playwright-report", ".gantry-runtime"].map((d) => path.join(src, d)));
  fs.cpSync(src, dest, { recursive: true, verbatimSymlinks: true, filter: (p) => !skip.has(p) });
  fs.cpSync(path.join(context.packager.projectDir, ".gantry-runtime"), path.join(resources, "gantry"), { recursive: true, verbatimSymlinks: true });
  console.log(`  • copied server bundle to ${path.relative(context.packager.projectDir, dest)}`);
};
