import 'server-only';
import { execFile } from 'node:child_process';

// The interactive CLIs Gantry opens chats in, and the headless forms of each that do not count as an open chat.
const AGENT = /(^|\/|\s)(claude|codex|opencode)(\s|$)/;
const HEADLESS = /\s(-p|--print)(\s|$)|(^|\/|\s)codex\s+exec(\s|$)|(^|\/|\s)opencode\s+(run|export)(\s|$)/;

/**
 * Whether a session is still open interactively (its chat in herdr).
 * Running the headless stage at the same time would give two writers to one conversation.
 */
export async function sessionOpenInTerminal(sessionId: string): Promise<boolean> {
  if (process.platform === 'win32' || !/^[\w-]+$/.test(sessionId)) return false;
  const out = await new Promise<string>((resolve) =>
    execFile('ps', ['-axo', 'command='], { timeout: 5000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => resolve(error ? '' : String(stdout))),
  );
  return out.split('\n').some((line) => line.includes(sessionId) && AGENT.test(line) && !HEADLESS.test(line));
}
