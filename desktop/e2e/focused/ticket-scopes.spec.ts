import { test, expect } from '@playwright/test';

test('service scope checkboxes support create, edit, unavailable services and empty workspaces', async ({ page }, testInfo) => {
  const project = {
    id: 'scopes', name: 'TEST_service_scope_workspace', branchPrefix: 'ticket',
    scopes: [{ id: 'both', label: 'Frontend + backend' }], agents: [], repositories: [],
    services: [{ id: 'web', repository: 'app' }, { id: 'api', repository: 'app' }, { id: 'worker', repository: 'jobs' }],
  };
  const tickets: Record<string, unknown>[] = [];
  const writes: Record<string, unknown>[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const json = (body: unknown) => route.fulfill({ json: body });
    if (pathname === '/api/gantry/api/status') return json({ projects: [project], tickets, previews: [], pulls: [], jobs: [] });
    if (pathname === '/api/agents') return json({ agents: [], current: null });
    if (pathname === '/api/spaces') return json({ spaces: [], current: null });
    if (pathname === '/api/gantry/api/projects/scopes/tickets') {
      const input = request.postDataJSON();
      writes.push(input);
      tickets.push({ ...input, id: 'scope-ticket', projectId: project.id, scope: 'both', status: 'backlog', branch: 'ticket/scope', run: null, pullRequests: [], artifacts: [] });
      return json(tickets[0]);
    }
    if (pathname === '/api/gantry/api/tickets/scope-ticket/update') {
      const input = request.postDataJSON();
      writes.push(input);
      Object.assign(tickets[0], input);
      if (Array.isArray(input.scopes)) tickets[0].scopeDescription = input.scopes.length ? input.scopes.join(', ') : 'No service scope selected (workspace-wide work)';
      return json(tickets[0]);
    }
    return route.fulfill({ status: 400, json: { error: 'Unmocked request blocked' } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'New ticket', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('combobox')).toHaveCount(0);
  await expect(dialog.getByRole('checkbox')).toHaveCount(3);
  await expect(dialog.getByRole('checkbox', { name: 'web', exact: true })).toBeChecked();
  await dialog.getByLabel('Title', { exact: true }).fill('TEST_service_scope_ticket');
  await dialog.getByRole('checkbox', { name: 'api', exact: true }).uncheck();
  await page.screenshot({ path: testInfo.outputPath('service-scopes-wide.png') });
  await page.setViewportSize({ width: 800, height: 900 });
  await page.screenshot({ path: testInfo.outputPath('service-scopes-narrow.png') });
  await page.setViewportSize({ width: 1440, height: 900 });
  await dialog.getByRole('button', { name: 'Create ticket', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].scopes).toEqual(['web', 'worker']);
  await page.getByRole('button', { name: 'Close details', exact: true }).click();
  project.services = project.services.filter((service) => service.id !== 'worker');
  await page.reload();
  await page.getByRole('button', { name: 'Edit ticket TEST_service_scope_ticket', exact: true }).click();
  await expect(dialog.getByRole('checkbox', { name: 'worker (unavailable)', exact: true })).toBeChecked();
  await dialog.getByRole('checkbox', { name: 'web', exact: true }).uncheck();
  await dialog.getByRole('checkbox', { name: 'worker (unavailable)', exact: true }).uncheck();
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1].scopes).toEqual([]);
  await page.getByRole('button', { name: 'Close details', exact: true }).click();
  delete tickets[0].scopes;
  tickets[0].scope = 'testing';
  tickets[0].scopeDescription = 'Legacy scope: testing';
  await page.reload();
  await page.getByRole('button', { name: 'Edit ticket TEST_service_scope_ticket', exact: true }).click();
  await expect(dialog.getByText('Legacy scope: testing. Select services to replace it.')).toBeVisible();
  await dialog.getByLabel('Title', { exact: true }).fill('TEST_legacy_scope_ticket');
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect.poll(() => writes.length).toBe(3);
  expect(writes[2]).not.toHaveProperty('scopes');
  expect(tickets[0].scope).toBe('testing');
  await dialog.getByRole('button', { name: 'Edit', exact: true }).click();
  await dialog.getByRole('checkbox', { name: 'web', exact: true }).check();
  await dialog.getByRole('checkbox', { name: 'web', exact: true }).uncheck();
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect.poll(() => writes.length).toBe(4);
  expect(writes[3].scopes).toEqual([]);
  await page.getByRole('button', { name: 'Close details', exact: true }).click();
  project.services = [];
  await page.reload();
  await page.getByRole('button', { name: 'New ticket', exact: true }).click();
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await expect(dialog.getByText('No services configured in gantry.yaml.')).toBeVisible();
});
