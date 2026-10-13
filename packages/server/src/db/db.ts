import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * SQLite persistence. `node:sqlite` keeps Gantry dependency-free at the
 * storage layer: no native builds, identical behavior across platforms.
 *
 * Writes go through small store modules; schema changes are numbered SQL
 * migrations applied once each, inside a transaction, tracked in
 * `schema_migrations`.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

export type Database = DatabaseSync;

export function openDatabase(file: string): Database {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function loadMigrations(): { version: number; name: string; sql: string }[] {
  const dir = path.join(here, 'migrations');
  const files = fs.readdirSync(dir).filter((name) => /^\d{3}_[a-z0-9_-]+\.sql$/.test(name)).sort();
  return files.map((name) => {
    const version = Number(name.slice(0, 3));
    return { version, name, sql: fs.readFileSync(path.join(dir, name), 'utf8') };
  });
}

export function migrate(db: Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((row) => Number((row as { version: number }).version)));
  for (const migration of loadMigrations()) {
    if (applied.has(migration.version)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(migration.version, migration.name, new Date().toISOString());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${migration.name} failed: ${(error as Error).message}`);
    }
  }
}
