import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A self-contained server for the desktop app (npm run app:build). `next dev` ignores it.
  output: "standalone",
  outputFileTracingRoot: process.cwd(),
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    root: process.cwd(),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
