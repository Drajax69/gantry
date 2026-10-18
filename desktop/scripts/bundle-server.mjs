// Copies the static assets next to Next's standalone server, which leaves them out.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, ".next", "standalone");
// A monorepo tracing root places the application under desktop/. Keep the
// existing Electron entry point at standalone/server.js.
const appOutput = path.join(out, "desktop");
if (fs.existsSync(path.join(appOutput, "server.js"))) {
  fs.cpSync(appOutput, out, { recursive: true });
  fs.rmSync(appOutput, { recursive: true });
}

// Flattening the monorepo output moves targets of Next's external-module aliases.
// Rewrite them relative to the shipped tree so installation never depends on
// the build machine's absolute paths.
function relocateLinks(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      const target = path.resolve(path.dirname(file), fs.readlinkSync(file));
      const relocated = target.startsWith(appOutput + path.sep) ? path.join(out, path.relative(appOutput, target)) : target;
      if (relocated.startsWith(out + path.sep)) {
        fs.unlinkSync(file);
        fs.symlinkSync(path.relative(path.dirname(file), relocated), file);
        if (!fs.existsSync(file)) throw new Error(`Broken standalone dependency: ${file}`);
      }
    } else if (entry.isDirectory()) relocateLinks(file);
  }
}
relocateLinks(out);

if (!fs.existsSync(path.join(out, "server.js"))) {
  console.error("No standalone build found. Run `next build` with output: \"standalone\" first.");
  process.exit(1);
}
fs.cpSync(path.join(root, ".next", "static"), path.join(out, ".next", "static"), { recursive: true });
if (fs.existsSync(path.join(root, "public"))) fs.cpSync(path.join(root, "public"), path.join(out, "public"), { recursive: true });
console.log("Server bundle ready at", path.relative(root, out));
