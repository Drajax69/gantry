import { defineConfig } from '@playwright/test';

// Attach only to the isolated local preview; do not start the broader E2E suite.
export default defineConfig({
  testDir: './checks',
  testMatch: 'permissions.spec.ts',
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  outputDir: process.env.PERMISSION_RESULTS || 'test-results/permissions',
  use: {
    baseURL: 'http://localhost:3457',
    viewport: { width: 1440, height: 900 },
    trace: 'on',
    video: 'on',
  },
});
