/**
 * Browser coverage against a REAL Gantry server (booted by Playwright's
 * webServer from scripts/e2e-server.mjs — that script owns the fixture
 * workspace, the server process, and teardown). The "agent" is the generic
 * adapter running a harmless node sleep, so no real coding agent launches.
 */
import { test, expect } from '@playwright/test';

const BASE = 'http://127.0.0.1:4620';

type StatusPayload = {
  tickets: { id: string; title: string; status: string; run: { state: string; sessionId: string | null } | null }[];
  previews: { branch: string; status: string; services: { id: string; state: string; port: number | null }[] }[];
};

async function status(): Promise<StatusPayload> {
  const response = await fetch(`${BASE}/api/status`);
  return (await response.json()) as StatusPayload;
}

function waitFor(condition: () => boolean, next: () => void, timeoutMs = 30000): void {
  const started = Date.now();
  const timer = setInterval(() => {
    if (condition() || Date.now() - started > timeoutMs) {
      clearInterval(timer);
      next();
    }
  }, 300);
}

test('dashboard loads and renders the fixture project', async ({ page }) => {
  await page.goto(BASE);
  await expect(page.locator('.brand')).toContainText('Gantry');
  await expect(page.locator('.tabs button').first()).toContainText('Tickets');
  await expect(page.getByRole('button', { name: '+ New ticket' })).toBeVisible();
  await expect(page.locator('.conn.ok')).toBeVisible();
});

test('ticket creation, prompt preview, agent run state, and Take over', async ({ page }) => {
  await page.goto(BASE);

  // 1. Create a ticket through the UI.
  await page.getByRole('button', { name: '+ New ticket' }).click();
  await page.getByLabel('Title').fill('Browser driven ticket');
  await page.getByLabel('Notes', { exact: true }).fill('Created by the browser test.');
  await page.getByRole('button', { name: 'Create ticket' }).click();
  await expect(page.getByRole('heading', { name: 'Browser driven ticket' })).toBeVisible();
  await expect(page.locator('.card .branch')).toContainText('codex/browser-driven-ticket');

  // 2. The Start dialog renders the final prompt before starting.
  await page.getByRole('button', { name: 'Start agent' }).click();
  await expect(page.getByText('Startup prompt (editable — the agent receives exactly this)')).toBeVisible();
  const promptBox = page.locator('.dialog textarea').last();
  await expect(promptBox).toHaveValue(/Implement the following ticket/);
  await expect(promptBox).toHaveValue(/codex\/browser-driven-ticket/);

  // 3. Start → the run appears and the card shows a live state.
  await page.getByRole('button', { name: 'Start agent' }).last().click();
  await waitFor(
    () => status().then(
      (payload) => Boolean(payload.tickets.find((candidate) => candidate.title === 'Browser driven ticket')?.run),
    ),
    () => void 0,
  );
  const card = page.locator('.card', { hasText: 'Browser driven ticket' });
  await expect(card.locator('.chip.live, .chip.bad, .chip.warn').first()).toBeVisible({ timeout: 30000 });

  // 4. Take over interrupts the run without a session id (generic agent).
  await expect(card.getByRole('button', { name: 'Take over' })).toBeVisible({ timeout: 30000 });
  await card.getByRole('button', { name: 'Take over' }).click();
  await waitFor(
    () => status().then((payload) => {
      const run = payload.tickets.find((candidate) => candidate.title === 'Browser driven ticket')?.run;
      return run?.state === 'ready' || run?.state === 'finished' || run?.state === 'failed';
    }),
    () => void 0,
  );
  await expect(card.locator('.chip.good, .chip.bad').first()).toBeVisible({ timeout: 15000 });
});

test('previews board shows the running main workspace with services', async ({ page }) => {
  await page.goto(BASE);
  await page.getByRole('tab', { name: /Previews/ }).click();
  const card = page.locator('.card', { hasText: 'Main workspace' });
  await expect(card).toBeVisible({ timeout: 20000 });
  await expect(card.locator('.service-line .name', { hasText: 'frontend' })).toBeVisible({ timeout: 30000 });
  await expect(card.getByText('Logs').first()).toBeVisible();
});
