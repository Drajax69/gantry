import { binaryCandidates } from '../packages/server/src/agents/binaries.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shellCommand } from '../packages/server/src/util/exec.js';
import { ownsProcess, interruptProcessGroup, processAlive } from '../packages/server/src/supervisor/processes.js';
import * as exec from '../packages/server/src/util/exec.js';

vi.mock('../packages/server/src/util/exec.js', async (original) => ({
  ...await original<typeof exec>(), run: vi.fn(), signalGroup: vi.fn(),
}));
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('Windows process supervision', () => {
  function windows(command: string | null = 'node C:\\work\\runner.cjs') {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    vi.mocked(exec.run).mockResolvedValue(JSON.stringify({ ProcessId: 123, CommandLine: command }));
  }
  it('queries CIM with a validated numeric PID and verifies the claim', async () => {
    windows();
    expect(await ownsProcess(123, 123, 'C:\\work\\runner.cjs')).toBe(true);
    expect(exec.run).toHaveBeenCalledWith('powershell.exe', expect.arrayContaining(['-NoProfile', '-NonInteractive']), { timeoutMs: 5000 });
    expect(await ownsProcess(123, 124, 'runner.cjs')).toBe(false);
    expect(await ownsProcess(123, 123, 'unrelated')).toBe(false);
    expect(await ownsProcess(123, 123, '')).toBe(false);
    expect(await processAlive(-1)).toBe(false);
  });
  it('fails closed when Windows denies access to the command line', async () => {
    windows(null);
    expect(await ownsProcess(123, 123, 'runner.cjs')).toBe(false);
    expect(await interruptProcessGroup(123, 123, 'runner.cjs', 0)).toEqual({ interrupted: false, escalated: false });
    expect(exec.signalGroup).not.toHaveBeenCalled();
  });
  it('rechecks ownership before forcefully terminating a tree', async () => {
    windows();
    expect(await interruptProcessGroup(123, 123, 'runner.cjs', 0)).toEqual({ interrupted: true, escalated: true });
    expect(exec.signalGroup).toHaveBeenNthCalledWith(1, 123, 'SIGTERM', 123);
    expect(exec.signalGroup).toHaveBeenNthCalledWith(2, 123, 'SIGKILL', 123);
  });
  it('does not escalate after the PID is reused', async () => {
    windows();
    vi.mocked(exec.run).mockResolvedValueOnce(JSON.stringify({ ProcessId: 123, CommandLine: 'runner.cjs' }))
      .mockResolvedValue(JSON.stringify({ ProcessId: 123, CommandLine: 'unrelated.exe' }));
    expect(await interruptProcessGroup(123, 123, 'runner.cjs', 0)).toEqual({ interrupted: true, escalated: false });
    expect(exec.signalGroup).toHaveBeenCalledTimes(1);
  });
});
it('selects the OS shell only for explicitly configured shell commands', () => {
  expect(shellCommand('echo hello', 'linux')).toEqual(['sh', ['-c', 'echo hello']]);
  expect(shellCommand('echo hello', 'darwin')).toEqual(['sh', ['-c', 'echo hello']]);
  expect(shellCommand('echo hello', 'win32')[1]).toEqual(['/d', '/s', '/c', 'echo hello']);
});

it('Windows ownership wrapper preserves literal arguments and exit status', async () => {
  const { execFileSync, spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const runner = fileURLToPath(new URL('../packages/server/runners/command-runner.cjs', import.meta.url));
  const values = ['space path', 'a&b', '%PATH%', '"quoted"', "apostrophe's"];
  const output = execFileSync(process.execPath, [runner, 'gantry-process-abc123', process.execPath, '-e', 'console.log(JSON.stringify(process.argv.slice(1)))', ...values], { encoding: 'utf8' });
  expect(JSON.parse(output)).toEqual(values);
  expect(spawnSync(process.execPath, [runner, 'gantry-process-abc123', process.execPath, '-e', 'process.exit(7)']).status).toBe(7);
});

it('finds Windows executables and npm shims without splitting drive letters', () => {
  expect(binaryCandidates('codex', { Path: 'C:\\Program Files\\node;D:\\tools' }, 'win32')).toContain('C:\\Program Files\\node\\codex.cmd');
  expect(binaryCandidates('claude', { PATH: '/usr/bin:/opt/tools' }, 'darwin')).toEqual(['/usr/bin/claude', '/opt/tools/claude']);
});
