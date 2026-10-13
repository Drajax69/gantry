import { test, describe } from 'vitest';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseProjectConfig, validateConfigReferences } from '../packages/shared/src/config/schema.js';
import { interpolate, VarError } from '../packages/shared/src/config/vars.js';
import { branchFor, isValidBranchName, slugFor } from '../packages/shared/src/branch.js';
import { isInside, safeJoin, validateManagedPath, PathError } from '../packages/shared/src/paths.js';

const validDocument = {
  apiVersion: 'gantry.dev/v1',
  project: { id: 'fixture', name: 'Fixture' },
  repositories: [
    { id: 'frontend', path: 'frontend' },
    { id: 'backend', path: 'backend' },
  ],
  services: [
    { id: 'frontend', repository: 'frontend', runtime: 'command', start: 'npm run dev -- --port ${port}' },
    { id: 'backend', repository: 'backend', runtime: 'command', install: 'npm ci', start: ['npm', 'run', 'dev'] },
  ],
};

describe('parseProjectConfig', () => {
  test('accepts a minimal valid document and applies defaults', () => {
    const result = parseProjectConfig(structuredClone(validDocument));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const config = result.config;
    assert.equal(config.project.defaultAgent, 'codex');
    assert.equal(config.project.defaultPromptTemplate, 'builtin:default');
    assert.equal(config.project.branchPrefix, 'ticket');
    assert.equal(config.project.portBase, 5200);
    assert.equal(config.repositories[0]!.remote, 'origin');
    assert.equal(config.repositories[0]!.defaultBranch, 'main');
    assert.equal(config.repositories[0]!.worktree, true);
    assert.equal(config.repositories[0]!.required, true);
    assert.equal(config.repositories[0]!.role, 'product');
    assert.equal(config.services[0]!.runtime, 'command');
    assert.deepEqual(config.services[1]!.start, { kind: 'argv', value: ['npm', 'run', 'dev'] });
    assert.equal(config.safety.testRecordPrefix, 'TEST_');
    assert.equal(config.safety.manualTestFile, 'manual-test-needed.md');
    assert.ok(config.scopes.length >= 5);
  });

  test('rejects a wrong apiVersion with a helpful message', () => {
    const result = parseProjectConfig({ ...structuredClone(validDocument), apiVersion: 'v2' });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.errors.some((error) => error.includes('apiVersion')), result.errors.join('; '));
  });

  test('rejects repository ids that are not lowercase kebab-case', () => {
    const doc = structuredClone(validDocument);
    (doc.repositories[0] as { id: string }).id = 'Frontend';
    const result = parseProjectConfig(doc);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.errors.some((error) => error.includes('repositories.0.id')), result.errors.join('; '));
  });

  test('requires start only for runtime command services', () => {
    const managed = structuredClone(validDocument);
    managed.services = [{ id: 'web', repository: 'frontend', runtime: 'vite' }];
    const managedParsed = parseProjectConfig(managed);
    assert.equal(managedParsed.ok, true);
    if (managedParsed.ok) assert.deepEqual(validateConfigReferences(managedParsed.config), []);

    // Schema-level parse accepts a missing start; the semantic check rejects it.
    const missing = structuredClone(validDocument);
    delete (missing.services[0] as { start?: unknown }).start;
    const parsed = parseProjectConfig(missing);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const errors = validateConfigReferences(parsed.config);
    assert.ok(errors.some((error) => error.includes('start')), errors.join('; '));
  });

  test('collects multiple validation problems in one pass', () => {
    const result = parseProjectConfig({ apiVersion: 'nope', project: { id: 'Bad Id', name: '' }, repositories: [] });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.errors.length >= 3, `expected several errors, got: ${result.errors.join('; ')}`);
  });
});

describe('validateConfigReferences', () => {
  test('passes for a consistent document', () => {
    const result = parseProjectConfig(structuredClone(validDocument));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(validateConfigReferences(result.config), []);
  });

  test('reports unknown repository and service references', () => {
    const result = parseProjectConfig(structuredClone(validDocument));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const config = result.config;
    config.services[0]!.repository = 'does-not-exist';
    config.services[0]!.dependsOn = ['ghost'];
    const errors = validateConfigReferences(config);
    assert.ok(errors.some((error) => error.includes('unknown repository "does-not-exist"')), errors.join('; '));
    assert.ok(errors.some((error) => error.includes('unknown service "ghost"')), errors.join('; '));
  });

  test('detects dependency cycles', () => {
    const doc = structuredClone(validDocument);
    doc.services = [
      { id: 'a', repository: 'frontend', runtime: 'command', start: 'x', dependsOn: ['b'] },
      { id: 'b', repository: 'backend', runtime: 'command', start: 'x', dependsOn: ['a'] },
    ];
    const parsed = parseProjectConfig(doc);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const errors = validateConfigReferences(parsed.config);
    assert.ok(errors.some((error) => error.includes('cycle')), errors.join('; '));
  });
});

describe('interpolate', () => {
  test('substitutes known variables and escapes $$', () => {
    assert.equal(interpolate('port ${port} costs $$5', { port: '5200' }), 'port 5200 costs $5');
  });

  test('unknown variables raise an error listing available names', () => {
    try {
      interpolate('see ${repo.frondend}', { 'repo.frontend': '/w/frontend' });
      assert.fail('expected VarError');
    } catch (error) {
      assert.ok(error instanceof VarError);
      assert.equal(error.variable, 'repo.frondend');
      assert.match(error.message, /repo\.frontend/);
    }
  });

  test('missing env references name the variable to set', () => {
    try {
      interpolate('token ${env:GANTRY_TEST_TOKEN_MISSING}', {});
      assert.fail('expected VarError');
    } catch (error) {
      assert.ok(error instanceof VarError);
      assert.match(error.message, /GANTRY_TEST_TOKEN_MISSING/);
      assert.match(error.message, /environment variable/);
    }
  });
});

describe('branch naming', () => {
  test('slugifies titles and applies the prefix', () => {
    assert.equal(branchFor('Fix exam timeout + review!', 'codex'), 'codex/fix-exam-timeout-review');
    const unicode = branchFor('Ünïcôde — spaced title', 'ticket');
    assert.ok(unicode.startsWith('ticket/'));
    assert.match(unicode.slice('ticket/'.length), /^[a-z0-9-]+$/);
    assert.equal(branchFor('', 'codex'), 'codex/ticket');
  });

  test('caps slug length', () => {
    const branch = branchFor('x'.repeat(500), 'codex');
    assert.ok(branch.length <= 'codex/'.length + 54);
    assert.ok(isValidBranchName(branch));
  });

  test('rejects names Git cannot use', () => {
    assert.equal(isValidBranchName('feature/ok.name-1'), true);
    assert.equal(isValidBranchName('a/b..c'), false);
    assert.equal(isValidBranchName('ends-with-slash/'), false);
    assert.equal(isValidBranchName('a/b/.hidden'), false);
    assert.equal(isValidBranchName('branch.lock'), false);
    assert.equal(isValidBranchName('-leading-dash'), false);
    assert.equal(isValidBranchName('has spaces'), false);
  });

  test('slugFor strips separators', () => {
    assert.equal(slugFor('Hello, World!'), 'hello-world');
    assert.equal(slugFor('///'), '');
  });
});

describe('path safety', () => {
  test('isInside treats the parent itself and children as inside', () => {
    assert.equal(isInside('/workspace', '/workspace'), true);
    assert.equal(isInside('/workspace', '/workspace/repo/file.txt'), true);
    assert.equal(isInside('/workspace', '/workspace-other'), false);
    assert.equal(isInside('/workspace', '/etc/passwd'), false);
  });

  test('safeJoin refuses traversal outside the parent', () => {
    assert.equal(safeJoin('/workspace', 'repo', 'file.txt'), path.resolve('/workspace/repo/file.txt'));
    assert.throws(() => safeJoin('/workspace', '..', 'escape'), PathError);
    assert.throws(() => safeJoin('/workspace', 'repo/../../escape'), PathError);
  });

  test('validateManagedPath rejects control characters and escapes', () => {
    assert.equal(validateManagedPath('/workspace', 'repo'), path.resolve('/workspace/repo'));
    assert.throws(() => validateManagedPath('/workspace', '../outside'), PathError);
    assert.throws(() => validateManagedPath('/workspace', 'bad\npath'), PathError);
    assert.throws(() => validateManagedPath('/workspace', '/etc/passwd'), PathError);
  });
});
