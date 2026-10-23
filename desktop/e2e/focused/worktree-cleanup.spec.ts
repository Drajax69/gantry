import { expect, test } from '@playwright/test';

test('Done ticket cleanup confirms assessed paths, retains blocked worktrees and reports partial results', async ({ page }) => {
  const ticket = { id: 'TEST_cleanup', projectId: 'test', title: 'TEST_cleanup_ticket', status: 'done', branch: 'ticket/test-cleanup', run: null, pullRequests: [], artifacts: [] };
  const ready = { repositoryId: 'frontend', path: '/fixture/.worktrees/ticket-test/frontend', head: 'a'.repeat(40), eligible: true, reason: 'Clean and merged' };
  const blocked = { repositoryId: 'backend', path: '/fixture/.worktrees/ticket-test/backend', head: 'b'.repeat(40), eligible: false, reason: 'This worktree has uncommitted or untracked files.' };
  let removed = false;
  let posts = 0;

  await page.route('**/api/**', async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/gantry/api/status') return route.fulfill({ json: {
      projects: [{ id: 'test', name: 'TEST_workspace', scopes: [], agents: [], repositories: [], services: [] }],
      tickets: [ticket], previews: [], pulls: [], jobs: [],
    } });
    if (pathname.endsWith('/worktree-cleanup')) {
      if (request.method() === 'GET') return route.fulfill({ json: { ticketId: ticket.id, blockers: [], checkouts: [ready, blocked] } });
      posts++;
      expect(request.postDataJSON()).toEqual({ confirm: true, checkouts: [ready] });
      removed = true;
      return route.fulfill({ json: {
        results: [{ ...ready, status: 'removed', reason: 'Worktree removed; branch retained.' }],
        assessment: { ticketId: ticket.id, blockers: [], checkouts: [blocked] },
      } });
    }
    if (pathname === '/api/setup') return route.fulfill({ json: { ok: true, herdr: { ok: true }, agent: { ok: true } } });
    if (pathname === '/api/agents') return route.fulfill({ json: { agents: [], current: null } });
    return route.fulfill({ status: 400, json: { error: `Unexpected request: ${pathname}` } });
  });

  await page.goto('/');
  const clean = page.getByRole('button', { name: 'Clean worktrees for TEST_cleanup_ticket', exact: true });
  await clean.click();
  const dialog = page.getByRole('dialog', { name: 'Clean merged worktrees' });
  await expect(dialog.getByText(ready.path, { exact: true })).toBeVisible();
  await expect(dialog.getByText(/uncommitted or untracked files/)).toBeVisible();
  expect(posts).toBe(0);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  expect(removed).toBe(false);
  await clean.click();
  await dialog.getByRole('button', { name: 'Remove 1 worktree', exact: true }).click();
  await expect(dialog.getByText(/frontend: removed/)).toBeVisible();
  await expect(dialog.getByText(blocked.path, { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Remove 0 worktrees' })).toBeDisabled();
  expect(posts).toBe(1);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('[data-ticket-id="TEST_cleanup"]')).toBeVisible();
});
