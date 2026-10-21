import { test, expect } from '@playwright/test';

test('opening a ticket highlights its current stage', async ({ page }) => {
  const ticket = {
    id: 'current-stage', title: 'Current stage fixture', projectId: 'stage-test',
    status: 'in_progress', position: 0, description: '', scope: 'both', scopes: ['both'],
    branch: 'test/current-stage', run: null, pullRequests: [], artifacts: [],
    execution: { state: 'waiting', activeNodeId: 'pr', message: 'Resolve conflicts', updatedAt: 1 },
    workflow: { revision: 1, graph: { nodes: [
      { id: 'implement', label: 'Implement', kind: 'agent', instructions: '', dependsOn: [] },
      { id: 'pr', label: 'Create PR', kind: 'agent', instructions: '', dependsOn: ['implement'] },
    ] }, states: { implement: { state: 'pending' }, pr: { state: 'failed' } } },
  };
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/gantry/api/status') return route.fulfill({ json: {
      projects: [{ id: 'stage-test', name: 'Stage test', scopes: [{ id: 'both', label: 'Both' }], agents: [], repositories: [], services: [] }],
      tickets: [ticket], previews: [], pulls: [], jobs: [],
    } });
    if (path === '/api/agents') return route.fulfill({ json: { agents: [], current: null } });
    if (path === '/api/setup') return route.fulfill({ json: { ok: true, herdr: { ok: true }, agent: { ok: true } } });
    if (path === '/api/workflow-execution') return route.fulfill({ json: null });
    return route.fulfill({ status: 400, json: { error: 'Unexpected request blocked' } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit ticket Current stage fixture', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  const selected = page.getByRole('combobox', { name: 'Selected workflow stage' });
  await expect(selected).toHaveValue('pr');
  await expect(page.locator('[data-step-id="pr"]')).toHaveAttribute('aria-pressed', 'true');
  await selected.selectOption('implement');
  await expect(page.locator('[data-step-id="implement"]')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Close details', exact: true }).click();
  await page.getByRole('button', { name: 'Edit ticket Current stage fixture', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(selected).toHaveValue('pr');
  await page.screenshot({ path: 'test-results/current-stage.png' });
  await page.setViewportSize({ width: 900, height: 650 });
  await expect(page.locator('[data-step-id="pr"]')).toBeVisible();
  await page.screenshot({ path: 'test-results/current-stage-compact.png' });
});
