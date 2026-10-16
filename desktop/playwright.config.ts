import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run fully offline: gh and claude are stand-ins from e2e/bin,
// and the repo under review is a local fixture built by e2e/setup.mjs.
const PORT = 3457;
const bin = path.resolve(__dirname, "e2e/bin");
const home = path.resolve(__dirname, "e2e/.tmp/home");

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
  },
  webServer: [{
    command: 'node e2e/gantry-server.mjs',
    url: 'http://127.0.0.1:3458/api/version',
    reuseExistingServer: false,
  }, {
    // E2E_BUNDLE=1 tests the server the Mac app ships (run `npm run app:bundle` first).
    command: process.env.E2E_BUNDLE
      ? `node e2e/setup.mjs && node .next/standalone/server.js`
      : `node e2e/setup.mjs && next dev -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      PR_LENS_HOME: home,
      PR_LENS_GANTRY_URL: "http://127.0.0.1:3458",
      PORT: String(PORT),
      HOSTNAME: "127.0.0.1",
    },
  }],
});
