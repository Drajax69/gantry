import { defineConfig } from '@playwright/test';
const baseURL = process.env.REVIEW_EDIT_URL || 'http://127.0.0.1:3461';
if (!['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname)) throw new Error('Local preview only');
export default defineConfig({ testDir: './checks', testMatch: 'review-edit.spec.ts', workers: 1, timeout: 60_000, expect: { timeout: 15_000 }, outputDir: '/private/tmp/TEST_c72bda82_results', use: { baseURL, viewport: { width: 1440, height: 900 }, trace: 'on', video: 'on' } });
