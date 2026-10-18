import { defineConfig } from '@playwright/test';

// Uses an already-running local worktree preview; never starts fixtures or seeds.
const baseURL = process.env.GANTRY_PREVIEW_URL || 'http://127.0.0.1:3469';
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseURL).hostname)) throw new Error('Local preview required');
export default defineConfig({
  testDir: 'e2e/focused', workers: 1, timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: process.env.GANTRY_EVIDENCE_DIR ? `${process.env.GANTRY_EVIDENCE_DIR}/run` : 'test-results/focused',
  use: { baseURL, trace: 'on', video: 'on', viewport: { width: 1440, height: 900 } },
});
