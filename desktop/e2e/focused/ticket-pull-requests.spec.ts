import { test, expect } from '@playwright/test';

test('ticket PR indicators use cached status on the board, graph and details', async ({ page }) => {
  const ticket = {
    id: 'pr-ticket',
    projectId: 'test',
    title: 'TEST_ticket_pr_status',
    description: '',
    status: 'done',
    scope: 'both',
    branch: 'ticket/pr-status',
    position: 0,
    run: null,
    artifacts: [],
    pullRequests: [{ role: 'frontend', number: 12, url: 'https://github.com/local/frontend/pull/12', title: 'Frontend changes' }],
  };
  const pull = (number: number, draft: boolean, ready: boolean, blockers: string[] = []) => ({
    number,
    draft,
    ready,
    blockers,
    title: 'Fixture changes',
    url: `https://github.com/local/frontend/pull/${number}`,
    branch: ticket.branch,
    head: 'fixture',
  });
  const groups = [
    {
      id: 'matching',
      projectId: 'test',
      branch: ticket.branch,
      ready: false,
      blockers: [],
      previewId: null,
      previewUrl: null,
      pulls: { frontend: pull(12, true, false, ['Draft']), backend: pull(13, false, true) },
    },
  ];
  const unexpected: string[] = [];
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/gantry/api/status')
      return route.fulfill({
        json: {
          projects: [{ id: 'test', name: 'TEST_workspace', scopes: [], agents: [], repositories: [], services: [] }],
          tickets: [ticket, { ...ticket, id: 'no-pr', title: 'TEST_no_pr', branch: 'ticket/no-pr', pullRequests: [] }],
          pulls: [
            ...groups,
            { ...groups[0], projectId: 'another', pulls: { unrelated: pull(99, false, true) } },
            { ...groups[0], branch: 'another-branch', pulls: { unrelated: pull(98, false, true) } },
          ],
          previews: [],
          jobs: [],
        },
      });
    if (pathname === '/api/agents') return route.fulfill({ json: { agents: [], current: null } });
    if (pathname === '/api/ticket-chat') return route.fulfill({ json: { conversation: null } });
    // The setup banner checks for herdr and a coding CLI; these fixtures have both.
    if (pathname === '/api/setup') return route.fulfill({ json: { ok: true, herdr: { ok: true, detail: '' }, agent: { ok: true, detail: '' } } });
    unexpected.push(pathname);
    return route.fulfill({ status: 400, json: { error: 'Unexpected request blocked' } });
  });
  await page.goto('/');
  const card = page.locator('[data-ticket-id="pr-ticket"]');
  await expect(card.getByLabel('frontend #12 · Draft', { exact: true })).toHaveCount(1);
  await expect(card.getByLabel('backend #13 · Ready', { exact: true })).toBeVisible();
  await expect(card.getByText(/unrelated/)).toHaveCount(0);
  await expect(page.locator('[data-ticket-id="no-pr"]').getByLabel('Pull requests', { exact: true })).toHaveCount(0);

  await page.screenshot({ path: 'test-results/ticket-pr-board.png', fullPage: true });

  groups[0].pulls.frontend = pull(12, false, false, ['Checks failed']);
  await page.getByRole('button', { name: 'Refresh Gantry', exact: true }).click();
  await expect(card.getByLabel('frontend #12 · Blocked', { exact: true })).toHaveAttribute('title', /Checks failed/);
  ticket.status = 'in_progress';
  await page.getByRole('button', { name: 'Refresh Gantry', exact: true }).click();
  await page.getByRole('button', { name: 'Graph', exact: true }).click();
  await expect(card.getByLabel('frontend #12 · Blocked', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/ticket-pr-graph.png', fullPage: true });
  await page.getByRole('button', { name: 'Toggle theme', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.screenshot({ path: 'test-results/ticket-pr-dark.png', fullPage: true });
  await page.getByRole('button', { name: 'Toggle theme', exact: true }).click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await card.getByRole('button').first().click();
  const details = page.getByRole('region', { name: 'Ticket details', exact: true });
  await expect(details.getByLabel('frontend #12 · Blocked', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close details', exact: true }).click();

  groups.length = 0;
  await page.getByRole('button', { name: 'Refresh Gantry', exact: true }).click();
  await expect(card.getByLabel('frontend #12 · Status unavailable', { exact: true })).toBeVisible();
  await expect(card.getByLabel('backend #13 · Ready', { exact: true })).toHaveCount(0);
  ticket.pullRequests = [];
  await page.getByRole('button', { name: 'Refresh Gantry', exact: true }).click();
  await expect(card.getByLabel('Pull requests', { exact: true })).toHaveCount(0);
  expect(unexpected).toEqual([]);
});
