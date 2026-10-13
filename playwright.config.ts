import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  globalTimeout: 300_000,
  use: { baseURL: 'http://127.0.0.1:4620' },
  webServer: {
    command: 'node scripts/e2e-server.mjs',
    url: 'http://127.0.0.1:4620/api/version',
    reuseExistingServer: false,
    timeout: 30_000,
  },
  reporter: [['list']],
});
