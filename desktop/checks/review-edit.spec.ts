import { expect, test } from '@playwright/test';
import path from 'node:path';
// Local browser contract; all API requests intercepted, no real records or agents.
test('edit, preserve a failed save, save, reload, and select code for AI', async ({ page }) => {
  const id = 'TEST_c72bda82/review/pull/1', file = 'TEST_c72bda82_code.ts';
  let text = 'export const answer = 41;\n', revision = 'initial';
  let conflict = false, saved = false;
  let asked: unknown;
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  const changed = { path: file, oldPath: null, status: 'M', additions: 1, deletions: 1, binary: false };
  await page.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url());
    let body: unknown = {};
    if (url.pathname === '/api/target') body = { target: { id, kind: 'pull', owner: 'TEST_c72bda82', repo: 'review', title: 'TEST_c72bda82_edit_review', subtitle: 'Test review', headSha: 'a'.repeat(40), baseSha: 'b'.repeat(40), url: 'https://github.com/TEST_c72bda82/review/pull/1' }, files: [changed], messages: [], pending: null, queued: [] };
    else if (url.pathname === '/api/file') body = { path: file, file: changed, rows: null, lines: text.trimEnd().split('\n').map(line => [[line, '#123456', '#eeeeee', 0]]), added: [1] };
    else if (url.pathname === '/api/file-edit') {
      if (req.method() === 'POST') {
        const input = req.postDataJSON();
        expect(input).toMatchObject({ id, path: file, revision });
        if (conflict) return route.fulfill({ status: 409, json: { error: 'This file changed on disk. Your draft is preserved.' } });
        text = input.text; revision = 'saved'; saved = true;
      }
      body = { text, revision };
    } else if (url.pathname === '/api/local-changes') body = { revision: saved ? 'saved' : 'initial', files: saved ? [changed] : [], commits: 0, branch: 'TEST_c72bda82_branch' };
    else if (url.pathname === '/api/tree') body = [file];
    else if (url.pathname === '/api/agents') body = { agents: [], current: null };
    else if (url.pathname === '/api/comments') body = { threads: [], comments: [] };
    else if (url.pathname === '/api/chat/events') return route.fulfill({ contentType: 'text/event-stream', body: ': connected\n\n' });
    else if (url.pathname === '/api/chat') { asked = req.postDataJSON(); body = { msg: { id: 'TEST_c72bda82_question', role: 'user', text: 'Explain this', anchor: (asked as { anchor: unknown }).anchor, ts: Date.now() } }; }
    else if (req.method() !== 'GET') throw new Error(`Unexpected mutation: ${url.pathname}`);
    return route.fulfill({ json: body });
  });
  await page.goto(`/${id}?file=${file}`);
  await page.getByRole('button', { name: 'Edit file', exact: true }).click();
  const editor = page.getByRole('textbox', { name: `Edit ${file}` });
  await expect(editor).toHaveValue(text);
  await editor.fill('export const answer = 42;\n');
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
  await page.waitForTimeout(3200);
  await expect(editor).toHaveValue('export const answer = 42;\n');
  conflict = true;
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('p[role=alert]')).toContainText('Your draft is preserved');
  await expect(editor).toHaveValue('export const answer = 42;\n');
  conflict = false;
  await editor.press('ControlOrMeta+s');
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  expect(text).toBe('export const answer = 42;\n');
  await page.getByRole('button', { name: 'Close editor' }).click();
  await expect(page.locator('[data-line="new-1"]')).toContainText('42');
  await page.reload();
  await page.getByRole('button', { name: 'Edit file', exact: true }).click();
  await expect(editor).toHaveValue('export const answer = 42;\n');
  await editor.focus();
  await editor.press('ControlOrMeta+a');
  await page.getByRole('button', { name: 'Ask about selection' }).click();
  const question = page.getByPlaceholder('Ask about this line…');
  await expect(question).toBeVisible();
  if (process.env.REVIEW_EDIT_EVIDENCE) await page.screenshot({ path: path.join(process.env.REVIEW_EDIT_EVIDENCE, 'final.png'), fullPage: true });
  await question.fill('Explain this'); await question.press('Enter');
  await expect.poll(() => asked).toMatchObject({ id, text: 'Explain this', anchor: { file, side: 'new', start: 1, end: 1, snippet: 'export const answer = 42;' } });
  expect(errors).toEqual([]);
});
