import { createHash, randomUUID } from 'node:crypto';

/** Short stable content-addressed id (12 hex chars), used for groups and previews. */
export function idFor(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

/** Opaque entity id for user-facing records (tickets, runs, jobs). */
export function newId(): string {
  return randomUUID();
}
