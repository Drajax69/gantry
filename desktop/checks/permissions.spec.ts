import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Requires an isolated local preview with e2e/bin on PATH; never runs a real agent.
test('new ticket chat persists Full Access before native launch and reuses its thread', async ({ page, request }) => {
  const title = 'TEST_58791e98_permission_issue';
  const home = process.env.PR_LENS_HOME || path.resolve('e2e/.tmp/home');
  const read = (file: string) => fs.readFileSync(path.join(home, file), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const agent = await request.post('/api/agents', { data: { kind: 'codex', name: title } });
  expect(agent.ok()).toBe(true);
  const { id: agentId } = await agent.json();
  expect((await request.patch('/api/agents', { data: { id: agentId, current: true } })).ok()).toBe(true);
  await page.goto('/');
  await page.getByRole('button', { name: 'New ticket', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByRole('button', { name: 'Create ticket', exact: true }).click();
  await page.getByRole('combobox', { name: 'Stage', exact: true }).selectOption('in_progress');
  await expect(page.getByText('New Codex chats start with Full Access, including filesystem and network access without approval prompts.')).toBeVisible();
  await page.getByRole('button', { name: 'Open chat', exact: true }).click();
  await expect(page.getByText('Opened this ticket in Codex', { exact: true })).toBeVisible();
  const protocol = read('codex-protocol.jsonl');
  const start = protocol.find(c => c.method === 'thread/start');
  expect(start.params).toMatchObject({ sandbox: 'danger-full-access', approvalPolicy: 'never', ephemeral: false });
  expect(start.params.config).toBeUndefined();
  const settings = protocol.find(c => c.method === 'thread/settings/update');
  expect(settings.params).toMatchObject({ sandboxPolicy: { type: 'dangerFullAccess' }, approvalPolicy: 'never' });
  expect(protocol.indexOf(settings)).toBeGreaterThan(protocol.findIndex(c => c.method === 'thread/inject_items'));
  expect(protocol.some(c => c.method === 'turn/start')).toBe(false);
  const id = settings.params.threadId;
  expect(read('codex-queued.jsonl')).toHaveLength(1);
  expect(read('external-launches.jsonl').at(-1).args[0]).toBe(`codex://threads/${id}`);
  await page.getByRole('button', { name: 'Open chat', exact: true }).click();
  await expect.poll(() => read('external-launches.jsonl').length).toBe(2);
  expect(read('codex-queued.jsonl')).toHaveLength(1);
  expect(read('codex-protocol.jsonl').filter(c => c.method === 'thread/start')).toHaveLength(1);
  // Preserve any permissions the user later selects in the native app.
  expect(read('codex-protocol.jsonl').filter(c => c.method === 'thread/settings/update')).toHaveLength(1);
  expect(read('external-launches.jsonl').at(-1).args[0]).toBe(`codex://threads/${id}`);
  await expect(page.getByText(new RegExp(`Linked to ${title}`))).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open chat', exact: true })).toBeEnabled();
  if (process.env.PERMISSION_EVIDENCE) await page.screenshot({ path: path.join(process.env.PERMISSION_EVIDENCE, 'final.png'), fullPage: true });
});
