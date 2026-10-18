import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import { parseProjectConfig } from '../packages/shared/src/config/schema.js';
import { interpolate, VarError } from '../packages/shared/src/config/vars.js';
import { templateBody, buildPromptVars, renderPrompt, validateTemplate, repositoryPath } from '../packages/server/src/prompts/engine.js';
import type { LoadedProject } from '../packages/server/src/projects/registry.js';
import type { TicketRow } from '../packages/server/src/tickets/store.js';

const doc = {
  apiVersion: 'gantry.dev/v1',
  project: { id: 'fixture', name: 'Fixture', defaultPromptTemplate: 'builtin:paper-setter-legacy', branchPrefix: 'codex' },
  repositories: [
    { id: 'frontend', path: 'examify' },
    { id: 'backend', path: 'examify-backend' },
    { id: 'e2e', path: 'examify-e2e', worktree: false, role: 'tooling' },
  ],
  services: [
    { id: 'frontend', repository: 'frontend', runtime: 'command', start: 'dev' },
    { id: 'backend', repository: 'backend', runtime: 'command', start: 'dev' },
  ],
};

function project(): LoadedProject {
  const parsed = parseProjectConfig(structuredClone(doc));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error('fixture config invalid');
  return {
    config: parsed.config,
    workspace: '/tmp/gantry-fixture-workspace',
    configPath: '/tmp/gantry-fixture-workspace/gantry.yaml',
  };
}

function ticket(overrides: Partial<TicketRow> = {}): TicketRow {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    project_id: 'fixture',
    title: 'Add exam folders',
    description: 'Let users group exams into folders.',
    status: 'in_progress',
    scope: 'both',
    branch: 'codex/add-exam-folders',
    additions: null,
    position: 0,
    active_run_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('templateBody', () => {
  test('resolves builtin templates', () => {
    const config = project().config;
    const legacy = templateBody(config, 'builtin:paper-setter-legacy');
    assert.equal(legacy.label, 'Paper Setter legacy');
    assert.deepEqual(legacy.chain, ['builtin:paper-setter-legacy']);
    const base = templateBody(config, 'builtin:default');
    assert.equal(base.label, 'Default');
  });

  test('chains extends parents and detects cycles', () => {
    const config = project().config;
    config.promptTemplates = [
      { id: 'child', label: 'Child', body: 'Child addition.', extends: 'parent' },
      { id: 'parent', label: 'Parent', body: 'Parent addition.' },
      { id: 'loop', label: 'Loop', body: 'a', extends: 'loop' },
    ];
    const child = templateBody(config, 'child');
    assert.match(child.body, /Parent addition\./);
    assert.match(child.body, /Child addition\./);
    assert.deepEqual(child.chain, ['parent', 'child']);
    assert.throws(() => templateBody(config, 'loop'), /cycle/);
  });

  test('unknown templates list the available ids', () => {
    const config = project().config;
    config.promptTemplates = [{ id: 'custom', label: 'Custom', body: 'x' }];
    try {
      templateBody(config, 'custoom');
      assert.fail('expected throw');
    } catch (error) {
      assert.match((error as Error).message, /builtin:default/);
      assert.match((error as Error).message, /builtin:paper-setter-legacy/);
      assert.match((error as Error).message, /custom/);
    }
  });
});

describe('Paper Setter legacy preset', () => {
  test('preserves the original behavioral contract', () => {
    const { body } = templateBody(project().config, 'builtin:paper-setter-legacy');
    for (const fragment of [
      'do not merge',
      '${safety.testRecordPrefix}',
      '${safety.manualTestFile}',
      'trace.zip',
      'video.webm',
      'final.png',
      'summary.md',
      'Playwright',
      'AGENTS.md',
      'Preserve unrelated work',
      'Create a GitHub pull request',
      '${repo.frontend}',
      '${repo.backend}',
      '${repo.e2e}',
      '${previewUrl}',
      '${artifactDir}',
      '${ticket.title}',
      '${ticket.branch}',
      '${ticket.scopeDescription}',
    ]) {
      assert.ok(body.includes(fragment), `legacy template missing ${fragment}`);
    }
  });

  test('renders with concrete values and keeps the safety contract', () => {
    const proj = project();
    const vars = buildPromptVars(proj, ticket(), {
      artifactDir: '/artifacts/ticket-1',
      previewUrl: 'http://127.0.0.1:5200',
      urls: { frontend: 'http://127.0.0.1:5200' },
      paths: {},
    });
    const rendered = interpolate(templateBody(proj.config, 'builtin:paper-setter-legacy').body, vars);
    assert.ok(rendered.includes('TEST_'), 'TEST_ prefix must render');
    assert.ok(rendered.includes('manual-test-needed.md'), 'manual test file must render');
    assert.ok(!rendered.includes('${'), 'all variables must be substituted');
    assert.ok(rendered.includes('/tmp/gantry-fixture-workspace/examify'), 'frontend worktree path renders');
    assert.ok(rendered.includes('/tmp/gantry-fixture-workspace/examify-backend'), 'backend worktree path renders');
    assert.ok(rendered.includes('http://127.0.0.1:5200'), 'preview URL renders');
    assert.ok(rendered.includes('do not merge'), 'no-merge rule must survive rendering');
  });

  test('empty ticket notes fall back to the sentinel sentence', () => {
    const proj = project();
    const vars = buildPromptVars(proj, ticket({ description: '' }), { artifactDir: '/a', previewUrl: null, urls: {}, paths: {} });
    assert.equal(vars['ticket.description'], 'No additional notes were provided.');
  });
});

describe('buildPromptVars', () => {
  test('exposes repo paths, ticket fields, safety values and service URLs', () => {
    const proj = project();
    const vars = buildPromptVars(proj, ticket(), { artifactDir: '/art', previewUrl: null, urls: { backend: 'http://127.0.0.1:5201' }, paths: { frontend: '/checkout' } });
    assert.equal(vars['repo.frontend'], '/tmp/gantry-fixture-workspace/examify');
    assert.equal(vars['repo.backend'], '/tmp/gantry-fixture-workspace/examify-backend');
    assert.equal(vars['repo.e2e'], '/tmp/gantry-fixture-workspace/examify-e2e');
    assert.equal(vars['ticket.title'], 'Add exam folders');
    assert.equal(vars['ticket.branch'], 'codex/add-exam-folders');
    assert.equal(vars['ticket.scope'], 'both');
    assert.equal(vars['ticket.scopeDescription'], 'frontend and backend');
    assert.equal(vars['safety.testRecordPrefix'], 'TEST_');
    assert.equal(vars['safety.manualTestFile'], 'manual-test-needed.md');
    assert.equal(vars['url.backend'], 'http://127.0.0.1:5201');
    assert.equal(vars['path.frontend'], '/checkout');
  });

  test('preview URL placeholder is honest when the preview is not ready', () => {
    const proj = project();
    const vars = buildPromptVars(proj, ticket(), { artifactDir: '/a', previewUrl: null, urls: {}, paths: {} });
    assert.match(vars['previewUrl']!, /not ready/);
  });
});

describe('renderPrompt', () => {
  test('composes base, instruction files, agent notes and ticket additions', () => {
    const proj = project();
    const vars = buildPromptVars(proj, ticket(), { artifactDir: '/a', previewUrl: 'http://x', urls: {}, paths: {}, previewLoginEmail: 'login@example.invalid' });
    const rendered = renderPrompt(proj, ticket(), vars, {
      ticket: ticket(),
      project: proj,
      instructionFiles: ['/tmp/AGENTS.md', '/tmp/examify/AGENTS.md'],
      agentNotes: 'Work autonomously.',
      ticketAdditions: 'Prefer small commits.',
    });
    assert.match(rendered.prompt, /Repository and workspace instructions/);
    assert.match(rendered.prompt, /\/tmp\/AGENTS\.md/);
    assert.match(rendered.prompt, /Work autonomously\./);
    assert.match(rendered.prompt, /Prefer small commits\./);
    assert.match(rendered.prompt, /Add exam folders/);
    assert.equal(rendered.templateLabel, 'Paper Setter legacy');
    assert.ok(rendered.layers.some((layer) => layer.kind === 'repo-instructions'));
    assert.ok(rendered.layers.some((layer) => layer.kind === 'base'));
  });

  test('omits empty layers', () => {
    const proj = project();
    const vars = buildPromptVars(proj, ticket(), { artifactDir: '/a', previewUrl: null, urls: {}, paths: {}, previewLoginEmail: 'login@example.invalid' });
    const rendered = renderPrompt(proj, ticket(), vars, { ticket: ticket(), project: proj, instructionFiles: [], agentNotes: '', ticketAdditions: null });
    assert.ok(!rendered.prompt.includes('Repository and workspace instructions'));
    assert.ok(!rendered.prompt.includes('Additional notes for this ticket'));
  });
});

describe('validateTemplate', () => {
  test('returns no errors for valid builtin templates', () => {
    const config = project().config;
    assert.deepEqual(validateTemplate(config, 'builtin:default'), []);
    assert.deepEqual(validateTemplate(config, 'builtin:paper-setter-legacy'), []);
  });

  test('reports unknown variables in project templates', () => {
    const config = project().config;
    config.promptTemplates = [{ id: 'broken', label: 'Broken', body: 'uses ${repo.frontned} here' }];
    const errors = validateTemplate(config, 'broken');
    assert.equal(errors.length, 1);
    assert.match(errors[0]!, /repo\.frontend/);
  });
});

describe('repositoryPath', () => {
  test('resolves repository ids against the workspace', () => {
    assert.equal(repositoryPath(project(), 'frontend'), '/tmp/gantry-fixture-workspace/examify');
    // Unknown ids degrade to the workspace itself rather than throwing.
    assert.equal(repositoryPath(project(), 'missing'), '/tmp/gantry-fixture-workspace');
  });
});

test('ticket graph instructions use the snapshot and include progress reporting', async () => {
  const { newWorkflow } = await import('../packages/shared/src/workflow.js');
  const proj = project();
  proj.config.project.defaultPromptTemplate = 'builtin:default';
  const workflow = newWorkflow();
  workflow.graph.nodes[0]!.label = 'Ticket-specific plan';
  const owner = ticket({ workflow_json: JSON.stringify(workflow) });
  const vars = buildPromptVars(proj, owner, { artifactDir: '/art', previewUrl: null, urls: {}, paths: {} });
  const result = renderPrompt(proj, owner, vars, { ticket: owner, project: proj, instructionFiles: [], agentNotes: '', workflowPort: 4598 });
  assert.match(result.prompt, /Ticket-specific plan/);
  assert.match(result.prompt, /after: plan/);
  assert.match(result.prompt, /gantry workflow 00000000-0000-4000-8000-000000000001/);
  assert.match(result.prompt, /delegated in parallel/);
  assert.match(result.prompt, /http:\/\/127.0.0.1:4598\/api\/tickets\//);
});
