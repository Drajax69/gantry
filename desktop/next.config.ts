import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // A self-contained server for the desktop app (npm run app:build). `next dev` ignores it.
  output: "standalone",
  outputFileTracingRoot: path.resolve(process.cwd(), ".."),
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    // Include the shared workflow schema used by browser-side graph imports.
    root: path.resolve(process.cwd(), ".."),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
