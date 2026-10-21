import { test, expect, type Page } from '@playwright/test';

async function fixture(page: Page, running = false) {
  let graph = { nodes: [{ id: 'plan', label: 'Plan', kind: 'agent', instructions: 'Make a plan', dependsOn: [] }] };
  let prompt = 'Follow the repository instructions.';
  const chatActions: string[] = [];
  await page.route('**/api/**', async route => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (data: unknown) => route.fulfill({ json: data });
    if (url.pathname === '/api/setup') return json({ ok: true });
    if (url.pathname === '/api/agents') return json({ agents: [], current: null });
    if (url.pathname === '/api/agents/models') return json({ models: [] });
    if (url.pathname === '/api/stage-permissions') return json({ allow: [], common: [] });
    if (url.pathname === '/api/workflow-execution') return json(null);
    if (url.pathname.endsWith('/chat-prompt')) {
      if (req.method() === 'POST') prompt = req.postDataJSON().prompt;
      return json({ prompt });
    }
    if (url.pathname.endsWith('/workflow')) {
      if (req.method() === 'POST') graph = req.postDataJSON().graph ?? req.postDataJSON();
      return json(graph);
    }
    if (url.pathname === '/api/ticket-chat') {
      if (req.method() === 'POST') chatActions.push(req.postDataJSON().action);
      return json({ conversation: null });
    }
    if (url.pathname.endsWith('/api/status')) return json({
      projects: ['demo', 'other'].map(id => ({ id, name: id === 'demo' ? 'Demo workspace' : 'Other workspace', services: [], agents: [], environments: [] })),
      tickets: [{ id: 'ticket', projectId: 'demo', title: 'Improve saving', branch: 'ticket/saving', status: 'in_progress', description: '', scopes: [], pullRequests: [], artifacts: [],
        workflow: { graph, revision: 0, states: { plan: { state: 'pending', message: '' } } },
        ...(running ? { execution: { state: 'running', activeNodeId: 'plan', message: 'Planning' } } : {}),
      }], pulls: [], previews: [], jobs: [],
    });
    return json({});
  });
  return chatActions;
}

async function changeNode(page: Page, text: string) {
  await page.getByRole('button', { name: 'Edit node Plan', exact: true }).click();
  await page.getByLabel('Node instructions').fill(text);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
}

function answerLeave(page: Page, accept: boolean) {
  page.once('dialog', async dialog => {
    if (dialog.type() !== 'beforeunload') expect(dialog.message()).toContain('unsaved');
    if (accept) await dialog.accept(); else await dialog.dismiss();
  });
}

test('workspace drafts warn on navigation, preserve cancelled edits, and clear after saving or discarding', async ({ page }) => {
  await fixture(page);
  await page.goto('/?workspace=demo&view=workflow');
  // Opening an old dependency-based graph must not count as a user edit.
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Edit shared instructions' })).toBeVisible();
  await changeNode(page, 'Keep this draft');
  answerLeave(page, false);
  await page.getByRole('navigation', { name: 'Gantry workspace', exact: true }).getByRole('button', { name: /Tickets/ }).click();
  await expect(page.getByRole('heading', { name: 'Workspace graph', exact: true })).toBeVisible();
  answerLeave(page, false);
  await page.getByRole('button', { name: 'Other workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Workspace graph', exact: true })).toBeVisible();
  answerLeave(page, false);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page).not.toHaveURL(/settings/);
  expect(await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true);
  await page.getByRole('button', { name: 'Save graph', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true);
  await changeNode(page, 'Discard this draft');
  answerLeave(page, true);
  await page.getByRole('navigation', { name: 'Gantry workspace', exact: true }).getByRole('button', { name: /Tickets/ }).click();
  await page.getByRole('button', { name: 'Workspace graph', exact: true }).click();
  await page.getByRole('button', { name: 'Edit node Plan', exact: true }).click();
  await expect(page.getByLabel('Node instructions')).toHaveValue('Keep this draft');
});

test('node and shared instructions warn before closing their own editors', async ({ page }) => {
  await fixture(page);
  await page.goto('/?workspace=demo&view=workflow');
  await page.getByRole('button', { name: 'Edit node Plan', exact: true }).click();
  await page.getByLabel('Node instructions').fill('Unapplied node edits');
  answerLeave(page, false);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Edit node', exact: true })).toBeVisible();
  answerLeave(page, true);
  await page.getByRole('button', { name: 'Close editor', exact: true }).click();
  await page.getByRole('button', { name: 'Edit shared instructions' }).click();
  await expect(page.getByText('Tell every stage how to work in your project.', { exact: false })).toBeVisible();
  await page.getByLabel('Starting prompt', { exact: true }).fill('Use our components and run npm test.');
  answerLeave(page, false);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByLabel('Starting prompt', { exact: true })).toHaveValue('Use our components and run npm test.');
  await page.getByRole('button', { name: 'Save prompt', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('ticket graph warns on view, tab, and dialog exit; saving leaves without prompting', async ({ page }) => {
  await fixture(page);
  await page.goto('/?workspace=demo&ticket=ticket');
  await page.getByRole('button', { name: 'Edit graph', exact: true }).click();
  await changeNode(page, 'Ticket-specific draft');
  answerLeave(page, false);
  await page.getByRole('button', { name: 'View progress', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Workflow canvas editor' })).toBeVisible();
  answerLeave(page, false);
  await page.getByRole('tab', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Workflow canvas editor' })).toBeVisible();
  answerLeave(page, false);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Improve saving', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save graph', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit graph', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close details', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('running ticket exposes master chat in its header and calls the ticket chat endpoint', async ({ page }) => {
  const actions = await fixture(page, true);
  await page.goto('/?workspace=demo&ticket=ticket');
  const dialog = page.getByRole('dialog', { name: 'Improve saving', exact: true });
  await dialog.locator('header').getByRole('button', { name: 'Open master chat', exact: true }).click();
  await expect.poll(() => actions).toEqual(['open']);
  await expect(dialog.getByRole('button', { name: 'Open chat', exact: true })).toHaveCount(0);
});

test('browser back can be cancelled and failed saves keep the unsaved warning', async ({ page }) => {
  await fixture(page);
  await page.goto('/?workspace=demo');
  await page.goto('/?workspace=demo&view=workflow');
  await changeNode(page, 'Retain after failed save');
  await page.route('**/api/gantry/api/projects/demo/workflow', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 500, json: { error: 'Could not save this graph' } }) : route.fallback());
  await page.getByRole('button', { name: 'Save graph', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Workflow canvas editor' }).getByRole('alert')).toContainText('Could not save this graph');
  const cancelled = page.waitForEvent('dialog');
  await page.evaluate(() => history.back());
  const warning = await cancelled;
  expect(['confirm', 'beforeunload']).toContain(warning.type());
  await warning.dismiss();
  await expect(page.getByRole('heading', { name: 'Workspace graph', exact: true })).toBeVisible();
  answerLeave(page, true);
  await page.evaluate(() => history.back());
  await expect(page.getByRole('region', { name: 'Ticket board', exact: true })).toBeVisible();
});
