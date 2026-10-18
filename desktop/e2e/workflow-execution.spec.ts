import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
test('workspace graph runs separate model-specific chats and corrects without approval', async ({ page, request }) => {
  const graph = {
    autoStart: true,
    nodes: [
      { id: 'plan', kind: 'agent', label: 'Plan', instructions: 'Plan the fixture', dependsOn: [], model: 'planner-fixture' },
      { id: 'build', kind: 'agent', label: 'Build', instructions: 'Implement the fixture', dependsOn: ['plan'], model: 'builder-fixture' },
      {
        id: 'review',
        kind: 'agent',
        label: 'Review',
        instructions: 'Review the fixture',
        dependsOn: ['build'],
        retryTarget: 'build',
        freshSession: true,
        model: 'reviewer-fixture',
      },
    ],
  };
  expect((await request.post('/api/gantry/api/projects/fixture/workflow', { data: graph })).ok()).toBe(true);
  await page.goto('/');
  await page.getByRole('button', { name: 'Workspace graph', exact: true }).click();
  await page.getByRole('button', { name: 'Edit node Plan', exact: true }).click();
  await expect(page.getByLabel('Node model')).toHaveValue('planner-fixture');
  await page.getByRole('button', { name: 'Close editor', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Run automatically' })).toBeVisible();
  await page.screenshot({ path: 'e2e/.tmp/workflow-model-controls.png' });
  await page
    .getByRole('navigation', { name: 'Gantry workspace' })
    .getByRole('button', { name: /Tickets/ })
    .click();
  await request.post('/api/gantry/api/projects/fixture/tickets', { data: { title: 'Automatic fixture' } });
  await request.post('/api/gantry/api/tickets/ticket-1/update', { data: { status: 'in_progress' } });
  await expect.poll(async () => (await (await request.get('/api/workflow-execution?ticketId=ticket-1')).json())?.state, { timeout: 30000 }).toBe('complete');
  const run = await (await request.get('/api/workflow-execution?ticketId=ticket-1')).json();
  expect(run.attempts.map((a: { nodeId: string }) => a.nodeId)).toEqual(['plan', 'build', 'review', 'build', 'review']);
  expect(run.attempts.map((a: { model: string }) => a.model)).toEqual([
    'planner-fixture',
    'builder-fixture',
    'reviewer-fixture',
    'builder-fixture',
    'reviewer-fixture',
  ]);
  expect(run.attempts[1].sessionId).toBe(run.attempts[3].sessionId);
  expect(run.attempts[2].sessionId).not.toBe(run.attempts[4].sessionId);
  expect(fs.readFileSync(path.resolve('e2e/.tmp/work/workflow-fixture.txt'), 'utf8')).toBe('Fixture correction implemented');
  expect((await request.post('/api/gantry/api/tickets/ticket-1/workflow-progress', { data: { nodeId: 'plan', state: 'running' } })).status()).toBe(409);
  await page.reload();
  await page.locator('article').filter({ hasText: 'Automatic fixture' }).getByRole('button').first().click();
  await expect(page.getByText('Automation · complete', { exact: true })).toBeVisible();
  await page.locator('[data-step-id="review"]').click();
  await page.getByText('Stage history · 2 attempts', { exact: true }).click();
  await expect(page.getByText('Fix fixture edge case', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'e2e/.tmp/workflow-completed-handover.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
