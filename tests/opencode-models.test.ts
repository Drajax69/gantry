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
  mocks.run.mockResolvedValue({ code: 0, stopped: false, stderr: '' });
});

function input(): RunInput {
  return {
    agent: { id: 'test', name: 'OpenCode', kind: 'opencode', model: 'gpt-6-astra' } as RunInput['agent'],
    cwd: '/path/to/workspace', system: 'Plan', prompt: 'Inspect', sessionId: 'ses_existing', history: [],
    signal: new AbortController().signal, workflow: { addDirs: [], reasoningEffort: 'medium' },
    hooks: { text: vi.fn(), tool: vi.fn(), session: vi.fn(), cost: vi.fn(), error: vi.fn() },
  };
}

test('legacy bare names resolve using the workspace catalog before resuming a failed session', async () => {
  const request = input();
  await opencode(request);
  expect(mocks.exec.mock.calls[0][2].cwd).toBe(request.cwd);
  expect(mocks.run.mock.calls[0][1]).toEqual(['run', '--format', 'json', '--auto', '--variant', 'medium', '--model', 'openai/gpt-6-astra', '--session', 'ses_existing']);
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
