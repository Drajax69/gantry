import { beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ exec: vi.fn(), run: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('../desktop/src/lib/server/spawn', () => ({ execFile: mocks.exec }));
vi.mock('../desktop/src/lib/server/agents/store', () => ({ CLI: { opencode: 'opencode' } }));
vi.mock('../desktop/src/lib/server/agents/driver', async (original) => ({ ...await original<object>(), runCli: mocks.run }));
import { qualifyOpenCodeModel, resolveOpenCodeModel } from '../desktop/src/lib/server/agents/opencode-models';
import { opencode } from '../desktop/src/lib/server/agents/opencode';
import type { RunInput } from '../desktop/src/lib/server/agents/driver';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.exec.mockImplementation((_cmd, _args, _opts, callback) => callback(null, 'openai/gpt-6-astra\nopenai/gpt-6.1-sol\n'));
  mocks.run.mockImplementation(async (_cmd, _args, opts) => {
    opts.onLine(JSON.stringify({ type: 'text', part: { text: 'Done.' } }));
    return { code: 0, stopped: false, stderr: '' };
  });
});

function input(): RunInput {
  return {
    agent: { id: 'test', name: 'OpenCode', kind: 'opencode', model: 'gpt-6-astra' } as RunInput['agent'],
    cwd: '/path/to/workspace', system: 'Plan', prompt: 'Inspect', sessionId: 'ses_existing', history: [],
    sessionDirectory: '/path/to/workspace',
    signal: new AbortController().signal, workflow: { addDirs: [], reasoningEffort: 'medium' },
    hooks: { text: vi.fn(), tool: vi.fn(), session: vi.fn(), cost: vi.fn(), error: vi.fn() },
  };
}

test('legacy bare names resolve using the workspace catalog before resuming a failed session', async () => {
  const request = input();
  await opencode(request);
  expect(mocks.exec.mock.calls[0][2].cwd).toBe(request.cwd);
  expect(mocks.run.mock.calls[0][1]).toEqual(['run', '--format', 'json', '--dir', request.cwd, '--print-logs', '--log-level', 'INFO', '--auto', '--variant', 'medium', '--model', 'openai/gpt-6-astra', '--session', 'ses_existing']);
  expect(request.hooks.error).not.toHaveBeenCalled();
});

test('provider defaults and qualified custom model IDs do not need discovery', async () => {
  expect(await resolveOpenCodeModel('')).toBe('');
  expect(await resolveOpenCodeModel('custom/team/model')).toBe('custom/team/model');
  expect(mocks.exec).not.toHaveBeenCalled();
});

test('ambiguous names require a dropdown choice instead of guessing a provider', () => {
  expect(() => qualifyOpenCodeModel('model', ['first/model', 'second/model'])).toThrow('matches multiple providers');
  expect(qualifyOpenCodeModel('second/model', ['first/model', 'second/model'])).toBe('second/model');
});

test('unknown models fail before starting an agent with actionable diagnostics', async () => {
  const request = input();
  request.agent.model = 'missing';
  await opencode(request);
  expect(mocks.run).not.toHaveBeenCalled();
  expect(request.hooks.error).toHaveBeenCalledWith(expect.stringContaining('Select a model in the stage dropdown'));
});

test('catalog failure gives installation guidance instead of an unexpected server error', async () => {
  mocks.exec.mockImplementation((_cmd, _args, _opts, callback) => callback(new Error('ENOENT')));
  await expect(resolveOpenCodeModel('gpt-6-astra')).rejects.toThrow('Could not load OpenCode models');
});

test('OpenCode errors include resolved model, session and the correct upstream log location', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    mocks.run.mockImplementation(async (_cmd, _args, opts) => {
      opts.onLine(JSON.stringify({ type: 'error', error: { data: { message: 'Unexpected server error.' } } }));
      return { code: 1, stopped: false, stderr: '' };
    });
    const request = input();
    await opencode(request);
    expect(request.hooks.error).toHaveBeenCalledTimes(1);
    expect(request.hooks.error).toHaveBeenCalledWith(expect.stringMatching(/openai\/gpt-6-astra.*ses_existing.*Unexpected server error.*opencode\/log/));
    expect(log).toHaveBeenCalled();
  } finally { log.mockRestore(); }
});

test('review edits are scoped to the checkout rather than an inherited app PWD', async () => {
  const request = input();
  request.workflow = undefined;
  request.cwd = '/path/to/review checkout';
  vi.stubEnv('PWD', '/path/to/gantry');
  try {
    await opencode(request);
    const [, args, options] = mocks.run.mock.calls[0];
    expect(args.slice(args.indexOf('--dir'), args.indexOf('--dir') + 2)).toEqual(['--dir', request.cwd]);
    expect(options.cwd).toBe(request.cwd);
    expect(options.env.PWD).toBe(request.cwd);
    const { permission } = JSON.parse(options.env.OPENCODE_CONFIG_CONTENT);
    expect(permission.edit).toBe('allow');
    expect(permission['*']).toBe('deny');
    expect(args).not.toContain('--auto');
  } finally { vi.unstubAllEnvs(); }
});

test('failed tool calls expose the permission error without marking a recovered turn failed', async () => {
  mocks.run.mockImplementation(async (_cmd, _args, opts) => {
    opts.onLine(JSON.stringify({ type: 'tool_use', part: { tool: 'read', state: { status: 'error', input: { filePath: '/outside/file.ts' }, error: 'external_directory permission denied' } } }));
    opts.onLine(JSON.stringify({ type: 'text', part: { text: 'Retried inside the local checkout.' } }));
    return { code: 0, stopped: false, stderr: '' };
  });
  const request = input();
  await opencode(request);
  expect(request.hooks.tool).toHaveBeenCalledWith({ name: 'read', detail: '/outside/file.ts · Failed: external_directory permission denied' });
  expect(request.hooks.error).not.toHaveBeenCalled();
});

test('resumed workflow sessions authorize the YAML workspace and all checkouts', async () => {
  const request = input();
  request.cwd = '/path/to/workspace/.worktrees/ticket/frontend';
  request.workflow = { workspace: '/path/to/workspace', addDirs: ['/path/to/other checkout/backend'] };
  await opencode(request);
  const options = mocks.run.mock.calls[0][2];
  expect(JSON.parse(options.env.OPENCODE_CONFIG_CONTENT).permission).toEqual({
    external_directory: {
      '/path/to/workspace/*': 'allow',
      '/path/to/workspace/.worktrees/ticket/frontend/*': 'allow',
      '/path/to/other checkout/backend/*': 'allow',
    },
  });
  expect(options.env.PWD).toBe(request.cwd);
});

test('permission waits stop the subprocess and report an actionable error once', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    mocks.run.mockImplementation(async (_cmd, _args, opts) => {
      opts.onStderrLine('level=INFO message=asking id=per_test permission=external_directory patterns=["/outside/*"]');
      expect(opts.signal.aborted).toBe(true);
      return { code: null, stopped: true, stderr: '' };
    });
    const request = input();
    await opencode(request);
    expect(request.signal.aborted).toBe(false);
    expect(request.hooks.error).toHaveBeenCalledTimes(1);
    expect(request.hooks.error).toHaveBeenCalledWith(expect.stringContaining('blocked awaiting external_directory permission'));
  } finally { log.mockRestore(); }
});

test('ordinary permission evaluation logs do not interrupt the agent', async () => {
  mocks.run.mockImplementation(async (_cmd, _args, opts) => {
    opts.onStderrLine('level=INFO message=evaluated permission=external_directory action.action=allow');
    expect(opts.signal.aborted).toBe(false);
    opts.onLine(JSON.stringify({ type: 'text', part: { text: 'Done.' } }));
    return { code: 0, stopped: false, stderr: '' };
  });
  const request = input();
  await opencode(request);
  expect(request.hooks.error).not.toHaveBeenCalled();
});

test.each([undefined, '/path/to/gantry'])(
  'unverified or incorrectly rooted sessions are refreshed for stages and coordinators (%s)',
  async (directory) => {
    for (const coordinator of [false, true]) {
      mocks.run.mockClear();
      const request = input();
      request.sessionDirectory = directory;
      request.coordinator = coordinator;
      request.history = [{ role: 'assistant', text: 'Previously validated preview changes.' }];
      await opencode(request);
      const [, args, options] = mocks.run.mock.calls[0];
      expect(args).not.toContain('--session');
      expect(options.env.PWD).toBe(request.cwd);
      expect(options.stdin).toContain('Previously validated preview changes.');
      expect(options.stdin).toContain(request.prompt);
    }
  },
);

test('an empty successful CLI exit is reported instead of silently accepting missing output', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    mocks.run.mockResolvedValue({ code: 0, stopped: false, stderr: '' });
    const request = input();
    await opencode(request);
    expect(request.hooks.error).toHaveBeenCalledWith(expect.stringContaining('exited without returning an answer'));
  } finally { log.mockRestore(); }
});
