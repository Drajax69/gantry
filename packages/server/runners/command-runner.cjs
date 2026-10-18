// Keep a unique ownership marker on a stable parent while Windows CLI shims
// spawn their own processes. taskkill /T terminates this parent and its tree.
const spawn = require('cross-spawn');
const [, , claim, bin, ...args] = process.argv;
if (!/^gantry-process-[a-f0-9-]+$/.test(claim || '') || !bin) process.exit(1);
const child = spawn(bin, args, { stdio: 'inherit', windowsHide: true });
child.once('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.once('close', (code) => { process.exitCode = code ?? 1; });
