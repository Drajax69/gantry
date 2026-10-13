import fs from 'node:fs';
import path from 'node:path';

/**
 * Minimal leveled logger writing to stderr and, when a data directory is
 * configured, to `server.log`. Agent/service stdout and stderr go to their
 * own per-run/per-service files instead of here.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  child(scope: string): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  file?: string;
  scope?: string;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const min = LEVEL_ORDER[options.level ?? 'info'];
  const scope = options.scope ? `[${options.scope}] ` : '';
  let stream: fs.WriteStream | null = null;
  if (options.file) {
    fs.mkdirSync(path.dirname(options.file), { recursive: true });
    stream = fs.createWriteStream(options.file, { flags: 'a', mode: 0o600 });
  }
  const write = (level: LogLevel, message: string): void => {
    if (LEVEL_ORDER[level] < min) return;
    const line = `${new Date().toISOString()} ${level.toUpperCase()} ${scope}${message}`;
    if (level === 'error') process.stderr.write(`${line}\n`);
    else console.log(line);
    stream?.write(`${line}\n`);
  };
  return {
    debug: (message) => write('debug', message),
    info: (message) => write('info', message),
    warn: (message) => write('warn', message),
    error: (message) => write('error', message),
    child: (childScope) => createLogger({ ...options, scope: `${options.scope ? `${options.scope}:` : ''}${childScope}` }),
  };
}
