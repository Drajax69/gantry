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
  await expect.poll(async () => {
    const payload = await status();
    return payload.tickets.find((ticket) => ticket.title === 'Browser driven ticket')?.run?.state;
  }, { timeout: 30000 }).toBe('running');
  const card = page.locator('.card', { hasText: 'Browser driven ticket' });
  await expect(card.locator('.chip.live, .chip.bad, .chip.warn').first()).toBeVisible({ timeout: 30000 });

  // 4. Take over interrupts the run without a session id (generic agent).
  await expect(card.getByRole('button', { name: 'Take over' })).toBeVisible({ timeout: 30000 });
  await card.getByRole('button', { name: 'Take over' }).click();
  await expect.poll(async () => {
    const payload = await status();
    return payload.tickets.find((ticket) => ticket.title === 'Browser driven ticket')?.run?.state;
  }, { timeout: 15000 }).toBe('ready');
  await expect(card.locator('.chip.good').first()).toBeVisible();
});

test('previews board shows the running main workspace with services', async ({ page }) => {
  await page.goto(BASE);
  await page.getByRole('tab', { name: /Previews/ }).click();
  const card = page.locator('.card', { hasText: 'Main workspace' });
  await expect(card).toBeVisible({ timeout: 20000 });
  await expect(card.locator('.service-line .name', { hasText: 'frontend' })).toBeVisible({ timeout: 30000 });
  await expect(card.getByText('Logs').first()).toBeVisible();
});

test('pull requests link to the matching PR Lens review', async ({ page }) => {
  await page.route('**/api/status', async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.pulls = [{
      id: 'lens-test', projectId: 'browser', branch: 'feature/review', ready: true,
      blockers: [], previewUrl: null,
      pulls: { frontend: { number: 42, title: 'Review this change', url: 'https://github.com/example/frontend/pull/42' } },
    }];
    await route.fulfill({ response, json: payload });
  });
  await page.goto(BASE);
  await page.getByRole('tab', { name: 'Pull requests' }).click();
  await expect(page.getByRole('link', { name: 'Open in PR Lens' }))
    .toHaveAttribute('href', 'pr-lens://review/example/frontend/pull/42');
  await expect(page.getByRole('link', { name: /frontend #42/ }))
    .toHaveAttribute('href', 'https://github.com/example/frontend/pull/42');
  await page.unrouteAll({ behavior: 'wait' });
});
