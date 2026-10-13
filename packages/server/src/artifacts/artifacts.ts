import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Ticket evidence (Playwright traces, videos, screenshots, summaries).
 * Artifacts may contain authenticated page data, so:
 *  - only an allowlist of filenames is ever served,
 *  - paths are constructed from the ticket id (UUID-checked) + allowlist,
 *    never from URL segments,
 *  - text/markdown renders inline; zips download; nothing executes.
 */

export interface ArtifactKind {
  kind: 'manual' | 'video' | 'trace' | 'screenshot' | 'summary' | 'log';
  label: string;
  type: string;
  disposition: 'inline' | 'attachment';
}

export const artifactFiles: Record<string, ArtifactKind> = {
  'manual-test-needed.md': { kind: 'manual', label: 'Manual test needed', type: 'text/markdown; charset=utf-8', disposition: 'inline' },
  'video.webm': { kind: 'video', label: 'Watch E2E video', type: 'video/webm', disposition: 'inline' },
  'trace.zip': { kind: 'trace', label: 'Download trace', type: 'application/zip', disposition: 'attachment' },
  'final.png': { kind: 'screenshot', label: 'View final screenshot', type: 'image/png', disposition: 'inline' },
  'summary.md': { kind: 'summary', label: 'Read E2E summary', type: 'text/markdown; charset=utf-8', disposition: 'inline' },
};

const TICKET_ID_RE = /^[a-f0-9-]{36}$/;

export function artifactDirectory(artifactsDir: string, ticketId: string): string {
  if (!TICKET_ID_RE.test(ticketId)) throw new Error('Invalid ticket id');
  return path.join(artifactsDir, ticketId);
}

export function resolveArtifact(artifactsDir: string, ticketId: string, file: string): (ArtifactKind & { file: string; path: string }) | null {
  if (!TICKET_ID_RE.test(ticketId) || !artifactFiles[file]) return null;
  return { ...artifactFiles[file], file, path: path.join(artifactDirectory(artifactsDir, ticketId), file) };
}

export async function listTicketArtifacts(artifactsDir: string, ticketId: string): Promise<(ArtifactKind & { file: string; url: string; size: number })[]> {
  let directory: string;
  try {
    directory = artifactDirectory(artifactsDir, ticketId);
  } catch {
    return [];
  }
  const result = [] as (ArtifactKind & { file: string; url: string; size: number })[];
  for (const [file, metadata] of Object.entries(artifactFiles)) {
    try {
      const stat = await fs.stat(path.join(directory, file));
      if (stat.isFile()) result.push({ ...metadata, file, size: stat.size, url: `/artifacts/${ticketId}/${file}` });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return result;
}

export async function ensureArtifactDirectory(artifactsDir: string, ticketId: string): Promise<string> {
  const directory = artifactDirectory(artifactsDir, ticketId);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  return directory;
}
