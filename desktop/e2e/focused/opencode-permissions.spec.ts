import { test, expect } from '@playwright/test';

test('OpenCode permission blocker offers exact Allow and retry from ticket details', async ({ page }) => {
  const graph = { nodes: [{ id: 'test', label: 'Test', kind: 'agent', instructions: '', dependsOn: [] }] };
  const ticket = {
    id: 'permission-fixture', title: 'OpenCode permission fixture', projectId: 'permission-test',
    status: 'in_progress', position: 0, description: '', scope: 'both', scopes: ['both'],
    branch: 'test/permission', run: null, pullRequests: [], artifacts: [],
    workflow: { revision: 1, graph, states: { test: { state: 'failed' } } },
  };
  const execution = {
    ticketId: ticket.id, projectId: ticket.projectId, graph, state: 'waiting', activeNodeId: 'test',
    steps: { test: 'failed' }, attempts: [], updatedAt: 1, message: 'Test needs read access',
    blocked: { nodeId: 'test', provider: 'opencode', rules: ['OpenCode(read:.env.template)'], alreadyAllowed: [], at: 1 },
  };
  const approvals: unknown[] = [];
  await page.route('**/api/**', async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const json = (body: unknown) => route.fulfill({ json: body });
    if (path === '/api/gantry/api/status') return json({
      projects: [{ id: ticket.projectId, name: 'Permission test', scopes: [{ id: 'both', label: 'Both' }], agents: [], repositories: [], services: [] }],
      tickets: [ticket], previews: [], pulls: [], jobs: [],
    });
    if (path === '/api/agents') return json({ agents: [], current: null });
    if (path === '/api/setup') return json({ ok: true, herdr: { ok: true }, agent: { ok: true } });
    if (path === '/api/stage-permissions') return json({ allow: [], common: [] });
    if (path === '/api/workflow-execution') {
      if (req.method() === 'POST') approvals.push(req.postDataJSON());
      return json(execution);
    }
    return route.fulfill({ status: 400, json: { error: 'Unexpected request blocked' } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit ticket OpenCode permission fixture', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  const panel = page.getByRole('group', { name: 'Allow tools for this workspace' });
  await expect(panel.getByText('OpenCode requested these permissions.', { exact: false })).toBeVisible();
  await expect(panel.getByRole('checkbox', { name: 'read: .env.template' })).toBeChecked();
  await panel.getByRole('button', { name: 'Allow and retry Test', exact: true }).click();
  expect(approvals).toEqual([{ ticketId: ticket.id, action: 'allow', nodeId: 'test', message: '', rules: ['OpenCode(read:.env.template)'] }]);
});
