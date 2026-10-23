import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

test('selects named graphs and saves an unsaved ticket draft as a separate template', async ({ page, request }) => {
  fs.rmSync(path.resolve('e2e/.tmp/home/workflow-runs/ticket-1.json'), { force: true });
  fs.rmSync(path.resolve('e2e/.tmp/home/ticket-conversations/ticket-1.json'), { force: true });
  const graph = {
    autoStart: false,
    nodes: [{ id: 'fix', label: 'Quick fix', kind: 'agent', instructions: 'Implement and verify.', dependsOn: [] }],
  };
  const added = await request.post('/api/gantry/api/projects/fixture/workflow-templates', {
    data: { name: 'Quick fixes', graph },
  });
  expect(added.status()).toBe(201);
  const template = await added.json();
  const defaultBefore = await (await request.get('/api/gantry/api/projects/fixture/workflow')).json();

  await page.goto('/?workspace=fixture');
  await page.getByRole('button', { name: 'New ticket', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Use a named graph');
  await page.getByLabel('Workspace graph template', { exact: true }).selectOption(template.id);
  await page.getByRole('button', { name: 'Create ticket', exact: true }).click();
  await expect(page.getByLabel('Selected workflow stage')).toHaveValue('fix');
  await page.getByRole('button', { name: 'Edit graph', exact: true }).click();
  await page.getByRole('button', { name: 'Edit node Quick fix', exact: true }).click();
  await page.getByLabel('Node name').fill('Ticket draft fix');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Add as workspace graph template', exact: true }).click();
  await page.getByLabel('Template name', { exact: true }).fill('Quick fixes');
  await page.getByRole('button', { name: 'Add template', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Duplicate' })).toBeVisible();
  await page.getByLabel('Template name', { exact: true }).fill('Ticket draft template');
  await page.getByRole('button', { name: 'Add template', exact: true }).click();
  await expect(page.getByText('Workspace graph template added.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save graph', exact: true })).toBeEnabled();

  const ticketRun = await (await request.get('/api/gantry/api/tickets/ticket-1/workflow')).json();
  expect(ticketRun.graph.nodes[0].label).toBe('Quick fix');
  expect(ticketRun.revision).toBe(0);
  const templates = await (await request.get('/api/gantry/api/projects/fixture/workflow-templates')).json();
  const saved = templates.find((item: { name: string }) => item.name === 'Ticket draft template');
  expect(saved.graph.nodes[0].label).toBe('Ticket draft fix');
  expect(saved.graph.autoStart).toBe(false);

  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Close details', exact: true }).click();
  await page.goto('/?workspace=fixture&view=workflow');
  await page.getByLabel('Workspace graph template', { exact: true }).selectOption(saved.id);
  await expect(page.getByRole('button', { name: 'Edit node Ticket draft fix', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit node Ticket draft fix', exact: true }).click();
  await page.getByLabel('Node name').fill('Updated template');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByLabel('Workspace graph template', { exact: true }).selectOption('default');
  await expect(page.getByLabel('Workspace graph template', { exact: true })).toHaveValue(saved.id);
  await expect(page.getByRole('button', { name: 'Edit node Updated template', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save graph', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeDisabled();
  await page.reload();
  await page.getByLabel('Workspace graph template', { exact: true }).selectOption(saved.id);
  await expect(page.getByRole('button', { name: 'Edit node Updated template', exact: true })).toBeVisible();
  expect(await (await request.get('/api/gantry/api/projects/fixture/workflow')).json()).toEqual(defaultBefore);
  expect((await (await request.get('/api/gantry/api/tickets/ticket-1/workflow')).json()).graph.nodes[0].label).toBe('Quick fix');
});
