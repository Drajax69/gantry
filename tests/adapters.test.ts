import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import { CodexAdapter, ClaudeCodeAdapter, OpenCodeAdapter, GenericAdapter } from '../packages/server/src/agents/adapters.js';
import type { AgentStartContext } from '../packages/server/src/agents/types.js';

function context(overrides: Partial<AgentStartContext> = {}): AgentStartContext {
  return {
    workspace: '/tmp/ws',
    prompt: 'Do the ticket work',
    addDirs: ['/tmp/ws/front', '/tmp/ws/back', '/tmp/artifacts'],
    binary: '/fake/bin/agent',
    args: {},
    ...overrides,
  };
}

describe('CodexAdapter', () => {
  const adapter = new CodexAdapter();

  test('buildStart produces the expected argv shape', () => {
    const spec = adapter.buildStart(context());
    assert.deepEqual(spec.argv.slice(1, 6), ['exec', '--json', '--skip-git-repo-check', '--approve-for-me', '-C']);
    assert.equal(spec.argv[6], '/tmp/ws');
    const addDirs = spec.argv.filter((token, index) => token === '--add-dir');
    assert.equal(addDirs.length, 3);
    assert.ok(spec.argv.includes('/tmp/artifacts'));
    assert.equal(spec.argv.at(-1), 'Do the ticket work', 'prompt is the final argument');
    assert.equal(spec.argv[0], '/fake/bin/agent');
    assert.equal(spec.cwd, '/tmp/ws');
  });

  test('parseSessionLine extracts codex thread ids and skips non-JSON', () => {
    assert.equal(adapter.parseSessionLine('{"thread_id":"th-1"}'), 'th-1');
    assert.equal(adapter.parseSessionLine('{"threadId":"th-2"}'), 'th-2');
    assert.equal(adapter.parseSessionLine('{"thread":{"id":"th-3"}}'), 'th-3');
    assert.equal(adapter.parseSessionLine('{"session_id":"se-1"}'), 'se-1');
    assert.equal(adapter.parseSessionLine('this is not json'), null);
    assert.equal(adapter.parseSessionLine('{"unrelated":true}'), null);
  });

  test('deep links and terminal resume', () => {
    assert.equal(adapter.deepLink('th-9'), 'codex://threads/th-9');
    const resume = adapter.buildResume('th-9', context());
    assert.ok(resume);
    assert.deepEqual(resume!.argv.slice(1), ['exec', 'resume', 'th-9']);
  });
});

describe('ClaudeCodeAdapter', () => {
  const adapter = new ClaudeCodeAdapter();

  test('buildStart uses print mode with stream-json and add-dirs', () => {
    const spec = adapter.buildStart(context({ args: { permissionMode: 'bypassPermissions' } }));
    assert.equal(spec.argv[1], '-p');
    assert.equal(spec.argv[2], 'Do the ticket work');
    assert.ok(spec.argv.includes('--output-format'));
    assert.ok(spec.argv.includes('stream-json'));
    assert.ok(spec.argv.includes('--add-dir'));
    assert.ok(spec.argv.includes('bypassPermissions'), 'permission mode override is honored');
    assert.equal(spec.cwd, '/tmp/ws');
  });

  test('session parsing, deep link absence, and terminal resume', () => {
    assert.equal(adapter.parseSessionLine('{"type":"system","session_id":"sess-42"}'), 'sess-42');
    assert.equal(adapter.parseSessionLine('{"type":"result"}'), null);
    assert.equal(adapter.parseSessionLine('garbage'), null);
    assert.equal(adapter.deepLink('sess-42'), null, 'no native deep link');
    const resume = adapter.buildResume('sess-42', context());
    assert.ok(resume);
    assert.deepEqual(resume!.argv.slice(1), ['--resume', 'sess-42']);
  });
});

describe('OpenCodeAdapter', () => {
  const adapter = new OpenCodeAdapter();

  test('parses opencode session ids from output', () => {
    assert.equal(adapter.parseSessionLine('session started ses_ABC123 ready'), 'ses_ABC123');
    assert.equal(adapter.parseSessionLine('no ids here'), null);
  });

  test('buildStart passes the prompt through', () => {
    const spec = adapter.buildStart(context());
    assert.deepEqual(spec.argv.slice(1), ['run', 'Do the ticket work']);
  });
});

function binaryBaseName(binary: string): string {
  return binary.split('/').pop() ?? binary;
}

describe('GenericAdapter', () => {
  const adapter = new GenericAdapter();

  test('substitutes ${prompt} as a single argv token — no shell string', () => {
    const nasty = 'do it; rm -rf $(pwd) && echo "pwned" | cat /etc/passwd';
    const spec = adapter.buildStart(context({ args: { command: 'node run-task.js --prompt ${prompt}' }, prompt: nasty }));
    assert.equal(spec.argv[0], 'node');
    assert.equal(spec.argv[1], 'run-task.js');
    assert.equal(spec.argv[2], '--prompt');
    assert.equal(spec.argv[3], nasty, 'the whole prompt arrives as ONE argv element');
    // No shell intermediates: argv never contains a shell binary.
    assert.ok(!['sh', 'bash', 'zsh', 'cmd', 'powershell'].includes(binaryBaseName(spec.argv[0]!)));
  });

  test('parses quoted arguments and preserves literal replacement characters', () => {
    const spec = adapter.buildStart(context({
      args: { command: `node   -e "setTimeout(() => {}, 60000)" '' --prompt "${'${prompt}'}"` },
      prompt: '$& ${workspace} "quoted"',
    }));
    assert.deepEqual(spec.argv, ['node', '-e', 'setTimeout(() => {}, 60000)', '', '--prompt', '$& ${workspace} "quoted"']);
  });

  test('rejects malformed or blank custom commands', () => {
    for (const command of ['   ', 'node "unclosed', 'node ' + String.fromCharCode(92)]) {
      assert.throws(() => adapter.buildStart(context({ args: { command } })), /Custom command/);
    }
  });

  test('reports its limits honestly', () => {
    assert.equal(adapter.buildResume('any', context()), null);
    assert.equal(adapter.deepLink('any'), null);
    assert.equal(adapter.parseSessionLine('{"session_id":"x"}'), null);
  });

  test('requires an explicit command template and never executes the prompt directly', () => {
    const adapter = new GenericAdapter();
    assert.throws(
      () => adapter.buildStart({ workspace: '/ws', prompt: 'some prompt text', addDirs: [], binary: 'configured-command', args: {} }),
      /agents\.generic\.args\.command/,
      'missing command template must fail loudly instead of executing the prompt',
    );
    const spec = adapter.buildStart({ workspace: '/ws', prompt: 'some prompt text', addDirs: [], binary: 'configured-command', args: { command: 'node run.js ${prompt}' } });
    assert.deepEqual(spec.argv, ['node', 'run.js', 'some prompt text']);
  });
});
