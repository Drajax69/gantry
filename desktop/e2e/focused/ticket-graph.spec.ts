import { test, expect } from '@playwright/test';

test('ticket graph shares actions and refreshes progress without losing navigation', async ({ page }) => {
  const label = 'TEST_1c70ede5';
  const tickets = [
    { id: 'active', title: label + '_active', status: 'in_progress' },
    { id: 'queued', title: label + '_queued', status: 'backlog' },
    { id: 'done', title: label + '_done', status: 'done' },
    { id: 'parallel', title: label + '_parallel', status: 'in_progress' },
  ].map((ticket, position) => ({
    ...ticket, position, projectId: 'graph-test', description: '', scope: 'both',
    branch: 'test/' + ticket.id, run: null, pullRequests: [], artifacts: [],
    workflow: { revision: 1, graph: { nodes: [
      { id: 'plan', label: 'Plan', kind: 'agent', instructions: '', dependsOn: [] },
      { id: 'build', label: 'Build', kind: 'agent', instructions: '', dependsOn: ['plan'] },
      { id: 'test', label: 'Test', kind: 'agent', instructions: '', dependsOn: ['plan'] },
      { id: 'review', label: 'Review', kind: 'human', instructions: '', dependsOn: ['build', 'test'] },
    ] }, states: {
      plan: { state: 'done', message: '' }, build: { state: 'running', message: '' },
      test: { state: 'running', message: '' }, review: { state: 'pending', message: '' },
    } },
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
  const workflow = graph.getByRole('region', { name: 'Workflow for ' + label + '_active', exact: true });
  await expect(workflow.locator('[data-ticket-id="active"]')).toBeVisible();
  await expect(graph.locator('[data-ticket-id="queued"], [data-ticket-id="done"]')).toHaveCount(0);
  await expect(graph.getByRole('region', { name: 'Workflow for ' + label + '_parallel', exact: true })).toBeVisible();
  await expect(workflow.locator('[data-step-id]')).toHaveCount(4);
  await expect(workflow.locator('svg g path')).toHaveCount(4);
  await expect(workflow.locator('[data-step-id="build"]')).toHaveAttribute('aria-current', 'step');
  await workflow.locator('[data-step-id="plan"]').click();
  await expect(workflow.locator('[data-step-id="build"]')).toHaveAttribute('aria-current', 'step');
  await workflow.getByRole('button', { name: 'Zoom in graph' }).click();
  await workflow.getByRole('button', { name: 'Fit', exact: true }).click();
  await expect.poll(() => workflow.getByLabel('Workflow graph', { exact: true }).evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: 'test-results/graph-view-workflows.png', fullPage: true });
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
  await expect(graph.locator('[data-ticket-id="queued"]')).toHaveCount(0);
  await expect(graph.getByText('No matching in-progress tickets.', { exact: true })).toBeVisible();
  await graph.getByRole('textbox', { name: 'Search ticket graph' }).fill('');
  await expect(graph.locator('[data-ticket-id="queued"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'New ticket', exact: true }).click();
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill(label + '_created');
  await page.getByRole('button', { name: 'Create ticket', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(graph.locator('[data-ticket-id="created"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Board', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Ticket board' }).locator('[data-ticket-id="created"]')).toBeVisible();
  await page.getByRole('button', { name: 'Graph', exact: true }).click();
  await page.reload();
  await expect(graph).toBeVisible();
  tickets[0].status = 'done';
  await expect(graph.locator('[data-ticket-id="active"]')).toHaveCount(0, { timeout: 6000 });
  tickets[3].status = 'done';
  await expect(graph.getByText('No in-progress tickets. Move a ticket to In progress to see its workflow here.', { exact: true })).toBeVisible({ timeout: 6000 });
  expect(unexpected).toEqual([]);
});

test('graph follows execution through correction loops and handles missing snapshots', async ({ page }) => {
  const nodes = ['plan', 'implement', 'review'].map((id, index, ids) => ({
    id, label: id, kind: 'agent', instructions: '', dependsOn: index ? [ids[index - 1]] : [],
    position: { x: index * 270, y: 50 },
  }));
  const ticket = {
    id: 'correction', projectId: 'graph-test', title: 'Correction loop', branch: 'test/correction',
    status: 'in_progress', position: 0, pullRequests: [], artifacts: [],
    execution: { activeNodeId: 'implement', state: 'paused', message: 'Check implementation', updatedAt: 1 },
    workflow: { revision: 1, graph: { nodes, edges: [
      { id: 'forward', source: 'plan', target: 'implement', label: 'Start' },
      { id: 'review', source: 'implement', target: 'review', label: 'Review' },
      { id: 'retry', source: 'review', target: 'implement', label: 'Changes requested' },
    ] }, states: {
      plan: { state: 'pending', message: '' }, implement: { state: 'pending', message: '' },
      review: { state: 'pending', message: '' },
    } },
  };
  await page.route('**/api/**', route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/gantry/api/status') return route.fulfill({ json: {
      projects: [{ id: 'graph-test', name: 'Graph test', scopes: [], agents: [], repositories: [], services: [] }],
      tickets: [ticket, { ...ticket, id: 'legacy', title: 'Legacy ticket', workflow: null, execution: undefined },
        { ...ticket, id: 'empty', title: 'Empty workflow', workflow: { revision: 1, graph: { nodes: [] }, states: {} }, execution: undefined }],
      previews: [], pulls: [], jobs: [],
    } });
    if (pathname === '/api/agents') return route.fulfill({ json: { agents: [], current: null } });
    if (pathname === '/api/setup') return route.fulfill({ json: { ok: true, herdr: { ok: true }, agent: { ok: true } } });
    return route.fulfill({ status: 400, json: { error: 'Unexpected request blocked' } });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Graph', exact: true }).click();
  const workflow = page.getByRole('region', { name: 'Workflow for Correction loop', exact: true });
  await expect(workflow.getByText('Current stage · implement', { exact: true })).toBeVisible();
  await expect(workflow.locator('[aria-current="step"]')).toHaveAttribute('data-step-id', 'implement');
  await expect(workflow.locator('svg g path')).toHaveCount(3);
  await expect(page.getByText('No workflow snapshot. Open the ticket to copy the workspace graph.', { exact: true })).toBeVisible();
  await expect(page.getByText('No workflow stages yet.', { exact: true })).toBeVisible();

  ticket.execution.activeNodeId = 'review';
  ticket.execution.state = 'waiting';
  await expect(workflow.locator('[aria-current="step"]')).toHaveAttribute('data-step-id', 'review', { timeout: 6000 });
  await page.setViewportSize({ width: 780, height: 780 });
  await expect.poll(() => workflow.getByLabel('Workflow graph', { exact: true }).evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
