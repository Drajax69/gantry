import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * The private preview auto-login credentials file (optional). Lives in the
 * Gantry data directory with 0600 permissions; the email doubles as the
 * identity asserted in prompts and by the preview banner. The password is
 * handed only to the browser bootstrap inside the managed preview — it is
 * never returned by the API or written to logs.
 */
export interface PreviewLogin {
  email: string;
  password: string;
}

export function previewLoginFile(dataDir: string): string {
  return path.join(dataDir, 'preview-login.json');
}

export async function readPreviewLogin(dataDir: string): Promise<PreviewLogin | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(previewLoginFile(dataDir), 'utf8')) as { email?: unknown; password?: unknown };
    if (typeof parsed.email === 'string' && parsed.email.trim() && typeof parsed.password === 'string' && parsed.password) {
      return { email: parsed.email.trim(), password: parsed.password };
    }
    return null;
  } catch {
    return null;
  }
}

export async function readPreviewLoginEmail(dataDir: string): Promise<string | null> {
  return (await readPreviewLogin(dataDir))?.email ?? null;
}
