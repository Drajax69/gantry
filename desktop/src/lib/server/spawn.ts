import { createRequire } from "node:module";
import { execFile as nativeExecFile, type spawn as nativeSpawn } from "node:child_process";

const require = createRequire(import.meta.url);
const crossSpawn = require("cross-spawn") as typeof nativeSpawn & {
  _parse(command: string, args: string[], options: object): { command: string; args: string[]; options: { windowsVerbatimArguments?: boolean } };
};
export const spawn = crossSpawn;

/** Resolve npm .cmd shims with cross-spawn's Windows argument escaping. */
export const execFile = ((command: string, args: string[], options: object, callback: Parameters<typeof nativeExecFile>[3]) => {
  const parsed = crossSpawn._parse(command, args, options);
  return nativeExecFile(parsed.command, parsed.args, { ...options, ...parsed.options }, callback);
}) as typeof nativeExecFile;

/** Reopen the detached Windows console instead of inheriting the server's pipes. */
export function spawnConsole(command: string, args: string[], cwd: string) {
  const script = `
    const fs = require('node:fs');
    const spawn = require(${JSON.stringify(require.resolve('cross-spawn'))});
    const [command, args] = JSON.parse(process.argv[1]);
    const input = fs.openSync('CONIN$', 'r');
    const output = fs.openSync('CONOUT$', 'w');
    const child = spawn(command, args, { stdio: [input, output, output] });
    child.once('error', error => { fs.writeSync(output, error.message); process.exitCode = 1; });
    child.once('close', code => { process.exitCode = code ?? 1; });
  `;
  return spawn(process.execPath, ['-e', script, JSON.stringify([command, args])], {
    cwd, detached: true, stdio: 'ignore', windowsHide: false,
    env: { ...process.env, ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) },
  });
}
