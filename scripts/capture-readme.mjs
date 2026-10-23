// Run the desktop dev server, then: node scripts/capture-readme.mjs [local URL]
// All API responses are synthetic; no workspace or agent is accessed.
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const baseURL = process.argv[2] || 'http://127.0.0.1:3469';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseURL).hostname)) throw new Error('Local preview required');
const node = (id, label, instructions, x, y, model) => ({
  id,
  label,
  instructions,
  kind: 'agent',
  dependsOn: [],
  position: { x, y },
  model,
  providerId: model === 'opus' ? 'claude' : 'codex',
});
const edge = (source, target, label) => ({ id: `${source}-${target}`, source, target, label });
const examples = [
  {
    name: 'review-loop',
    graph: {
      autoStart: true,
      entryNodeId: 'plan',
      nodes: [
        node('plan', 'Plan the change', 'Explore the codebase. Define the approach and acceptance criteria.', 60, 100, 'opus'),
        node('build', 'Implement & test', 'Build the feature and run relevant tests. Address review feedback.', 440, 100, 'gpt-5.4'),
        node('review', 'Review the work', 'Check correctness, edge cases, and test coverage against the plan.', 820, 100, 'opus'),
        node('pr', 'Open a pull request', 'Summarize the change, validation, and any remaining limitations in a PR.', 440, 420, 'gpt-5.4'),
      ],
      edges: [
        edge('plan', 'build', 'Plan ready'),
        edge('build', 'review', 'Ready for review'),
        edge('review', 'build', 'Changes requested'),
        edge('review', 'pr', 'Review passed'),
      ],
    },
  },
  {
    name: 'bug-triage',
    graph: {
      autoStart: true,
      entryNodeId: 'triage',
      nodes: [
        node('triage', 'Investigate the bug', 'Reproduce the issue and identify whether it is in the UI or API.', 60, 260, 'opus'),
        node('ui', 'Fix the frontend', 'Fix the UI issue and add a regression test.', 460, 80, 'gpt-5.4'),
        node('api', 'Fix the backend', 'Fix the API issue and add a regression test.', 460, 440, 'gpt-5.4'),
        node('verify', 'Verify the fix', 'Run the reproduction and relevant tests. Summarize the evidence.', 860, 260, 'opus'),
      ],
      edges: [
        edge('triage', 'ui', 'UI issue'),
        edge('triage', 'api', 'API issue'),
        edge('ui', 'verify', 'Frontend fix ready'),
        edge('api', 'verify', 'Backend fix ready'),
      ],
    },
  },
];

const browser = await chromium.launch();
try {
  for (const example of examples) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, colorScheme: 'dark' });
    await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
    await page.route('**/api/**', (route) => {
      const url = new URL(route.request().url());
      const json = (data) => route.fulfill({ json: data });
      if (url.pathname === '/api/setup') return json({ ok: true });
      if (url.pathname === '/api/agents')
        return json({
          agents: [
            { id: 'claude', name: 'Claude Code', kind: 'claude' },
            { id: 'codex', name: 'Codex', kind: 'codex' },
          ],
          current: 'claude',
        });
      if (url.pathname === '/api/agents/models') return json({ models: [] });
      if (url.pathname === '/api/workflow-execution') return json(null);
      if (url.pathname.endsWith('/workflow-templates'))
        return json([{ id: 'default', name: example.name === 'review-loop' ? 'Feature delivery' : 'Bug triage', graph: example.graph }]);
      if (url.pathname.endsWith('/workflow')) return json(example.graph);
      if (url.pathname.endsWith('/chat-prompt')) return json({ prompt: 'Follow repository conventions. Validate your work and leave a clear handover.' });
      if (url.pathname.endsWith('/api/status'))
        return json({
          projects: [{ id: 'demo', name: 'Launchpad', services: [], agents: [], environments: [] }],
          tickets: [],
          pulls: [],
          previews: [],
          jobs: [],
        });
      return json({});
    });
    await page.goto(`${baseURL}/?workspace=demo&view=workflow`);
    await page.getByRole('button', { name: `Edit node ${example.graph.nodes[0].label}`, exact: true }).waitFor();
    await page.getByRole('button', { name: /Fit/ }).click();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: fileURLToPath(new URL(`../docs/images/graph-${example.name}.png`, import.meta.url)),
      style: 'nextjs-portal { visibility: hidden; }',
    });
    await page.close();
  }
} finally {
  await browser.close();
}
