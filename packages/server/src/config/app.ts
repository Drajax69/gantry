import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Application-level settings. Everything lives under a private per-user data
 * directory (never inside a workspace, never inside the repository tree):
 *
 *   macOS    ~/Library/Application Support/gantry
 *   Linux    $XDG_DATA_HOME/gantry  (or ~/.local/share/gantry)
 *   Windows  %APPDATA%/gantry
 *
 * `GANTRY_DATA_DIR` overrides the location (useful for tests).
 */

export interface AppSettings {
  host: string;
  port: number;
  /** UI origins allowed to call the API when the dashboard is served separately in dev. */
  allowedOrigins: string[];
  /** How often the fast, local-only discovery pass runs (ms). */
  discoverIntervalMs: number;
  /** How often remote Git/GitHub sync runs (ms). Never blocks ticket starts. */
  remoteSyncIntervalMs: number;
  /** Grace period before SIGTERM/SIGKILL during takeover interrupts (ms). */
  takeoverGraceMs: number;
  serviceReadinessTimeoutMs: number;
}

export interface AppContext {
  dataDir: string;
  dbFile: string;
  logDir: string;
  logsDir: string;
  runsDir: string;
  artifactsDir: string;
  tmpDir: string;
  uiDir: string | null;
  settings: AppSettings;
}

function defaultDataDir(): string {
  if (process.env.GANTRY_DATA_DIR) return path.resolve(process.env.GANTRY_DATA_DIR);
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'gantry');
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'gantry');
  }
  const dataHome = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share');
  return path.join(dataHome, 'gantry');
}

function readDevOrigins(): string[] {
  const raw = process.env.GANTRY_DEV_ORIGINS;
  if (!raw) return [];
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

export function createAppContext(overrides: Partial<AppSettings> = {}): AppContext {
  const dataDir = defaultDataDir();
  for (const dir of [dataDir, path.join(dataDir, 'logs'), path.join(dataDir, 'runs'), path.join(dataDir, 'artifacts'), path.join(dataDir, 'tmp')]) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const port = Number(process.env.GANTRY_PORT ?? 4500);
  const host = process.env.GANTRY_HOST ?? '127.0.0.1';
  if (host !== '127.0.0.1' && host !== 'localhost') {
    // Explicitly confirmed non-loopback binds are the only way Gantry leaves
    // localhost; warn loudly rather than silently exposing the control plane.
    console.warn(`GANTRY_HOST=${host}: binding beyond loopback exposes this machine's Git and agents to the network`);
  }
  return {
    dataDir,
    dbFile: path.join(dataDir, 'gantry.db'),
    logDir: path.join(dataDir, 'logs'),
    logsDir: path.join(dataDir, 'logs'),
    runsDir: path.join(dataDir, 'runs'),
    artifactsDir: path.join(dataDir, 'artifacts'),
    tmpDir: path.join(dataDir, 'tmp'),
    uiDir: process.env.GANTRY_UI_DIR ?? null,
    settings: {
      host,
      port: Number.isFinite(port) && port > 0 ? port : 4500,
      allowedOrigins: readDevOrigins(),
      discoverIntervalMs: Number(process.env.GANTRY_DISCOVER_INTERVAL_MS ?? 15_000),
      remoteSyncIntervalMs: Number(process.env.GANTRY_REMOTE_INTERVAL_MS ?? 120_000),
      takeoverGraceMs: Number(process.env.GANTRY_TAKEOVER_GRACE_MS ?? 4_000),
      serviceReadinessTimeoutMs: Number(process.env.GANTRY_SERVICE_READY_TIMEOUT_MS ?? 120_000),
      ...overrides,
    },
  };
}
