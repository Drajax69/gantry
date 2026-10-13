import fs from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { interpolate, type ServiceConfig, type EnvironmentConfig, type ProjectConfig } from '@gantry/shared';

/**
 * Service environment assembly, in increasing precedence:
 *
 *   1. Gantry's own environment (inherited)
 *   2. repository env files from the primary checkout
 *   3. repository env files from this preview's checkout (wins over primary)
 *   4. selected environment's private env files (workspace-relative)
 *   5. selected environment's non-secret values
 *   6. per-service env values (interpolated)
 *   7. Gantry runtime markers (PORT, HOST, GANTRY_*)
 *
 * Repository env files are never rewritten; secrets loaded here stay in this
 * process and are handed only to the child process.
 */

export interface EnvContext {
  project: ProjectConfig;
  workspace: string;
  checkoutPath: string;
  primaryPath: string | null;
  service: ServiceConfig;
  port: number;
  environment: EnvironmentConfig | null;
  vars: Record<string, string>;
}

async function loadEnvFiles(env: Record<string, string>, files: string[], baseDir: string): Promise<void> {
  for (const name of files) {
    const file = path.resolve(baseDir, name);
    const contents = await fs.readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (contents === null) continue;
    Object.assign(env, parseEnv(contents));
  }
}

export async function buildServiceEnv(context: EnvContext): Promise<Record<string, string>> {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  const repoRoot = path.basename(context.checkoutPath);
  const primaryRoot = context.primaryPath ? path.basename(context.primaryPath) : null;

  if (context.primaryPath && context.service.envFiles.length) {
    await loadEnvFiles(env, context.service.envFiles, context.primaryPath);
  }
  if (context.checkoutPath !== context.primaryPath && context.service.envFiles.length) {
    await loadEnvFiles(env, context.service.envFiles, context.checkoutPath);
  }
  if (context.environment) {
    const envFile = context.environment.envFiles[context.service.id];
    if (envFile) await loadEnvFiles(env, [envFile], context.workspace);
    for (const [key, value] of Object.entries(context.environment.env)) {
      env[key] = interpolate(value, context.vars);
    }
  }
  const serviceVars: Record<string, string> = {
    ...context.vars,
    port: String(context.port),
    repoDir: repoRoot,
    ...(primaryRoot ? { primaryDir: primaryRoot } : {}),
  };
  for (const [key, value] of Object.entries(context.service.env)) {
    env[key] = interpolate(value, serviceVars);
  }
  env.PORT = String(context.port);
  env.HOST = '127.0.0.1';
  env.GANTRY_PREVIEW_SERVICE = context.service.id;
  env.GANTRY_WORKSPACE = context.workspace;
  return env;
}

/**
 * Resolve the command to execute for a role ("install", "start"), honoring
 * per-platform overrides and `${var}` interpolation.
 */
export function resolveServiceCommand(
  service: ServiceConfig,
  role: 'install' | 'start',
  vars: Record<string, string>,
  platform: NodeJS.Platform = process.platform,
): { kind: 'shell'; value: string } | { kind: 'argv'; value: string[] } | null {
  const override = service.platform?.[platform === 'win32' ? 'win32' : platform === 'darwin' ? 'darwin' : 'linux'];
  const command = override?.[role] ?? service[role];
  if (!command) return null;
  if (command.kind === 'argv') return { kind: 'argv', value: command.value };
  return { kind: 'shell', value: interpolate(command.value, vars) };
}
