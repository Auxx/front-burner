import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Database } from './open-database';

/**
 * The database was migrated by a newer version of Front Burner than this one
 * (NF-7.3, A-4.7). `unknown` holds the `created_at` values of the applied
 * migrations that this version does not have.
 */
export class NewerSchemaError extends Error {
  constructor(readonly unknown: number[]) {
    super(
      `The database was migrated by a newer version of Front Burner (${unknown.length} unknown migration(s))`
    );
    this.name = 'NewerSchemaError';
  }
}

// Drizzle's journal is written by `drizzle-kit generate` together with the
// first migration; until then a folder has no migrations.
function journalPath(migrationsFolder: string): string | undefined {
  const path = join(migrationsFolder, 'meta', '_journal.json');
  return existsSync(path) ? path : undefined;
}

function knownMigrations(migrationsFolder: string): Set<number> {
  const path = journalPath(migrationsFolder);
  if (!path) {
    return new Set();
  }
  const journal = JSON.parse(readFileSync(path, 'utf8')) as { entries: { when: number; }[]; };
  return new Set(journal.entries.map(entry => entry.when));
}

export function assertNoNewerMigrations(database: Database, migrationsFolder: string): void {
  const table = database.sqlite
    .prepare('SELECT name FROM sqlite_master WHERE type = \'table\' AND name = \'__drizzle_migrations\'')
    .get();
  if (!table) {
    return;
  }
  const known = knownMigrations(migrationsFolder);
  const applied = database.sqlite
    .prepare('SELECT created_at FROM __drizzle_migrations ORDER BY created_at')
    .all()
    .map(row => Number((row as { created_at: unknown; }).created_at));
  const unknown = applied.filter(createdAt => !known.has(createdAt));
  if (unknown.length > 0) {
    throw new NewerSchemaError(unknown);
  }
}

export function applyMigrations(database: Database, migrationsFolder: string): void {
  if (!journalPath(migrationsFolder)) {
    return;
  }
  migrate(database.db, { migrationsFolder });
}
