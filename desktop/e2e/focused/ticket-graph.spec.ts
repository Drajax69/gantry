import { test, expect } from '@playwright/test';

test('ticket graph shares actions and refreshes progress without losing navigation', async ({ page }) => {
  const label = 'TEST_1c70ede5';
  const tickets = [
    { id: 'active', title: label + '_active', status: 'in_progress' },
    { id: 'queued', title: label + '_queued', status: 'backlog' },
  ].map((ticket, position) => ({
    ...ticket, position, projectId: 'graph-test', description: '', scope: 'both',
    branch: 'test/' + ticket.id, run: null, pullRequests: [], artifacts: [],
    workflow: { revision: 1, graph: { nodes: [{ id: 'build', label: 'Build', kind: 'agent', instructions: '', dependsOn: [] }] }, states: { build: { state: 'running', message: '' } } },
    conversation: { provider: 'codex', providerName: label + '_provider', sessionId: 'test-session' },
  }));
  const opens: string[] = [];
  const unexpected: string[] = [];
  let reads = 0;
  await page.route('**/api/**', async route => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown) => route.fulfill({ json: body });
    if (url.pathname === '/api/gantry/api/status') {
      reads++;
      return json({
        projects: [{ id: 'graph-test', name: label + '_workspace', scopes: [{ id: 'both', label: 'Both' }], agents: [], repositories: [], services: [] }],
        tickets, previews: [], pulls: [], jobs: [],
      });
    }
    if (url.pathname === '/api/agents') return json({ agents: [], current: null });
    if (url.pathname === '/api/stage-permissions') return json({ allow: [] });
    if (url.pathname === '/api/workflow-execution') return json(null);
    if (url.pathname.endsWith('/workflow-templates')) return json([{ id: 'default', name: 'Default', graph: tickets[0].workflow.graph }]);
    if (url.pathname === '/api/ticket-chat') {
      if (req.postDataJSON().action === 'open') opens.push(req.postDataJSON().ticketId);
      return json({ conversation: tickets[0].conversation });
    }
    if (url.pathname === '/api/gantry/api/projects/graph-test/tickets' && req.method() === 'POST') {
      const ticket = { ...tickets[1], ...req.postDataJSON(), id: 'created', position: 2 };
      tickets.push(ticket);
      return json(ticket);
    }
    // The setup banner checks for herdr and a coding CLI; these fixtures have both.
    if (url.pathname === '/api/setup') return json({ ok: true, herdr: { ok: true, detail: '' }, agent: { ok: true, detail: '' } });
    unexpected.push(req.method() + ' ' + url.pathname);
    return route.fulfill({ status: 400, json: { error: 'Unexpected request blocked' } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Graph', exact: true }).click();
  const graph = page.getByRole('region', { name: 'Ticket graph', exact: true });
  await expect(graph).toHaveCSS('display', 'flex');
  await expect(graph.getByRole('region', { name: 'In progress nodes' }).locator('[data-ticket-id="active"]')).toBeVisible();
  await graph.getByRole('button', { name: 'Open chat for ' + label + '_active', exact: true }).click();
  expect(opens).toEqual(['active']);
  const before = reads;
  tickets[0].title = label + '_updated';
  tickets[0].workflow.states.build.state = 'waiting';
  await expect(graph.getByText(label + '_updated', { exact: true })).toBeVisible({ timeout: 6000 });
  expect(reads).toBeGreaterThan(before);
  await expect(graph.locator('[data-ticket-id="active"]').getByRole('status', { name: 'Waiting on you: Build', exact: true })).toBeVisible();
  await expect(graph.locator('[data-ticket-id="active"]').getByText('Chat linked · ' + label + '_provider', { exact: true })).toBeVisible();
  await graph.getByRole('textbox', { name: 'Search ticket graph' }).fill('_queued');
  await expect(graph.locator('[data-ticket-id="active"]')).toHaveCount(0);
  await expect(graph.locator('[data-ticket-id="queued"]')).toBeVisible();
  await graph.getByRole('textbox', { name: 'Search ticket graph' }).fill('');
  await graph.getByRole('button', { name: 'In progress only', exact: true }).click();
  await expect(graph.locator('[data-ticket-id="queued"]')).toHaveCount(0);
  await graph.getByRole('button', { name: 'In progress only', exact: true }).click();
  await page.getByRole('button', { name: 'New ticket', exact: true }).click();
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill(label + '_created');
  await page.getByRole('button', { name: 'Create ticket', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(graph.locator('[data-ticket-id="created"]')).toBeVisible();
  await page.getByRole('button', { name: 'Board', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Ticket board' }).locator('[data-ticket-id="created"]')).toBeVisible();
  await page.getByRole('button', { name: 'Graph', exact: true }).click();
  await page.reload();
  await expect(graph).toBeVisible();
  expect(unexpected).toEqual([]);
});
