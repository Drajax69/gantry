// Stage a self-contained Gantry runtime; only source/runtime files enter the app.
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const source = process.env.PR_LENS_GANTRY_SOURCE || path.resolve(root, "..");
const dest = path.join(root, ".gantry-runtime");
if (!source) {
  // An already-staged runtime supports subsequent UI-only builds.
  await fs.access(path.join(dest, "packages/cli/bin/gantry.js")).catch(() => {
    throw new Error("Set PR_LENS_GANTRY_SOURCE to the Gantry repository for the first desktop build.");
  });
} else {
  const src = path.resolve(source);
  if (src === dest || src.startsWith(dest + path.sep)) throw new Error("Gantry source must be outside the staging directory.");
  await fs.access(path.join(src, "packages/cli/bin/gantry.js"));
  await fs.rm(dest, { recursive: true, force: true });
  await fs.mkdir(dest, { recursive: true });
  for (const file of ["package.json", "package-lock.json", "LICENSE", "tsconfig.base.json"]) {
    await fs.copyFile(path.join(src, file), path.join(dest, file));
  }
  for (const name of ["shared", "server", "cli", "ui"]) {
    const target = path.join(dest, "packages", name);
    await fs.mkdir(target, { recursive: true });
    await fs.copyFile(path.join(src, "packages", name, "package.json"), path.join(target, "package.json"));
    if (name !== "ui") {
      await fs.cp(path.join(src, "packages", name, "src"), path.join(target, "src"), { recursive: true });
    }
  }
  for (const relative of ["packages/cli/bin", "packages/server/runners", "packages/ui/dist"]) {
    await fs.cp(path.join(src, relative), path.join(dest, relative), { recursive: true });
  }
  execFileSync("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund"], { cwd: dest, stdio: "inherit" });
}
console.log("Gantry runtime staged.");
