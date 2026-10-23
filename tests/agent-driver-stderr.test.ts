import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('../desktop/src/lib/server/spawn', () => ({ spawn: mocks.spawn }));
vi.mock('../desktop/src/lib/server/agents/store', () => ({ CLI: { claude: 'claude' } }));
import { runCli } from '../desktop/src/lib/server/agents/driver';
import { claude } from '../desktop/src/lib/server/agents/claude';
import type { RunInput } from '../desktop/src/lib/server/agents/driver';

test('stderr diagnostics are delivered as complete lines across chunk boundaries', async () => {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
  });
  mocks.spawn.mockReturnValue(child);
  const onStderrLine = vi.fn();
  const result = runCli('agent', [], {
    cwd: '/path/to/workspace', stdin: '', signal: new AbortController().signal,
    onLine: vi.fn(), onStderrLine,
  });
  child.stderr.write('message=ask');
  expect(onStderrLine).not.toHaveBeenCalled();
  child.stderr.write('ing permission=external_directory\nlast diagnostic');
  expect(onStderrLine).toHaveBeenCalledExactlyOnceWith('message=asking permission=external_directory');
  child.emit('close', 0, null);
  expect(onStderrLine).toHaveBeenLastCalledWith('last diagnostic');
  expect(await result).toMatchObject({ code: 0, stopped: false, stderr: 'message=asking permission=external_directory\nlast diagnostic' });
});

test('Claude retains resume, workspace permissions, streamed output and denial reporting', async () => {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
  });
  mocks.spawn.mockReturnValue(child);
  const hooks = { text: vi.fn(), tool: vi.fn(), session: vi.fn(), cost: vi.fn(), error: vi.fn(), denied: vi.fn() };
  const result = claude({
    agent: { kind: 'claude', model: 'test-model' } as RunInput['agent'], cwd: '/path/to/workspace',
    sessionId: 'existing-claude-session', system: 'Stage instructions', prompt: 'Continue', history: [],
    workflow: { addDirs: ['/path/to/backend'], allowedTools: ['Read'], settings: '/path/to/settings.json' },
    signal: new AbortController().signal, hooks,
  });
  const [, args] = mocks.spawn.mock.calls.at(-1)!;
  expect(args).toEqual(expect.arrayContaining(['--resume', 'existing-claude-session', '--add-dir', '/path/to/backend', '--allowedTools', 'Read', '--settings', '/path/to/settings.json', '--dangerously-skip-permissions']));
  expect(args).not.toContain('--print-logs');
  child.stderr.write('message=asking permission=external_directory\n');
  const event = JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Finished validation.' } } });
  child.stdout.write(event.slice(0, 20));
  child.stdout.write(event.slice(20) + '\n');
  const denials = [{ tool_name: 'Bash', tool_input: { command: 'blocked command' } }];
  child.stdout.write(JSON.stringify({ type: 'result', session_id: 'existing-claude-session', total_cost_usd: 0.2, permission_denials: denials }) + '\n');
  child.emit('close', 0, null);
  await result;
  expect(hooks.text).toHaveBeenCalledExactlyOnceWith('Finished validation.');
  expect(hooks.session).toHaveBeenCalledWith('existing-claude-session');
  expect(hooks.denied).toHaveBeenCalledWith(denials);
  expect(hooks.cost).toHaveBeenCalledWith(0.2);
  expect(hooks.error).not.toHaveBeenCalled();
});
