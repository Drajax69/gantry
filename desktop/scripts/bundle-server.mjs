// Copies the static assets next to Next's standalone server, which leaves them out.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, ".next", "standalone");
if (!fs.existsSync(path.join(out, "server.js"))) {
  console.error("No standalone build found. Run `next build` with output: \"standalone\" first.");
  process.exit(1);
}
fs.cpSync(path.join(root, ".next", "static"), path.join(out, ".next", "static"), { recursive: true });
if (fs.existsSync(path.join(root, "public"))) fs.cpSync(path.join(root, "public"), path.join(out, "public"), { recursive: true });
console.log("Server bundle ready at", path.relative(root, out));
