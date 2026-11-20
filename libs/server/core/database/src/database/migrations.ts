import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { instanceState } from '../schema/instance-state';
import { Database } from './open-database';

/**
 * The database was migrated by a newer version of Front Burner than this one
 * (NF-7.3, A-4.7). `unknown` holds the `created_at` values of the applied
 * migrations that this version does not have; `lastVersion` the version that
 * last started on the database, null when it recorded none.
 */
export class NewerSchemaError extends Error {
  constructor(readonly unknown: number[], readonly lastVersion: string | null = null) {
    // Quoted in the deployment guide (docs/wiki/deployment.md): change both together.
    super(
      `Database is from ${
        lastVersion === null ? 'a newer version' : `version ${lastVersion}`
      }; restore the pre-upgrade snapshot to go back`
    );
    this.name = 'NewerSchemaError';
  }
}

/** The database's migrations against the folder's. */
export interface MigrationState {
  /** Applied migrations; 0 for a new database. */
  applied: number;
  /**
   * The folder's migrations that Drizzle's migrator will apply: those after
   * the newest applied one, as it compares with that alone.
   */
  pending: number;
  /** The `created_at` values of applied migrations that the folder does not have (NF-7.3). */
  unknown: number[];
}

function hasTable(database: Database, name: string): boolean {
  return database.sqlite
    .prepare('SELECT 1 FROM sqlite_master WHERE type = \'table\' AND name = ?')
    .get(name) !== undefined;
}

function appliedMigrations(database: Database): number[] {
  if (!hasTable(database, '__drizzle_migrations')) {
    return [];
  }
  return database.sqlite
    .prepare('SELECT created_at FROM __drizzle_migrations ORDER BY created_at')
    .all()
    .map(row => Number((row as { created_at: unknown; }).created_at));
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
  let journal: { entries?: { when: number; }[]; };
  try {
    journal = JSON.parse(readFileSync(path, 'utf8')) as typeof journal;
  } catch (error) {
    throw new Error(`The migration journal ${path} is not valid JSON: ${(error as Error).message}`);
  }
  if (!Array.isArray(journal?.entries)) {
    throw new Error(`The migration journal ${path} has no "entries" array`);
  }
  return new Set(journal.entries.map(entry => entry.when));
}

/**
 * The version that last started on the database (`instance_state.last_version`);
 * null for a new database, or one from before the column existed.
 */
export function readLastVersion(database: Database): string | null {
  if (!hasTable(database, 'instance_state')) {
    return null;
  }
  const columns = database.sqlite.prepare('PRAGMA table_info(instance_state)').all() as { name: string; }[];
  if (!columns.some(column => column.name === 'last_version')) {
    return null;
  }
  const row = database.sqlite.prepare('SELECT last_version FROM instance_state WHERE id = 1').get() as
    | { last_version: string | null; }
    | undefined;
  return row?.last_version ?? null;
}

/**
 * Records the version that started on the database, after its migrations
 * (NF-7.1). Creates the instance's row when it has none yet.
 */
export function recordVersion(database: Database, version: string): void {
  // The onboarding state is worked out later (OnboardingStateService); `required` only fills a new row.
  database.db.insert(instanceState)
    .values({ id: 1, onboardingState: 'required', lastVersion: version })
    .onConflictDoUpdate({ target: instanceState.id, set: { lastVersion: version } })
    .run();
}

/** The database's migrations against the folder's, from one read of each. */
export function migrationState(database: Database, migrationsFolder: string): MigrationState {
  const applied = appliedMigrations(database);
  const known = knownMigrations(migrationsFolder);
  const newest = applied.at(-1) ?? Number.NEGATIVE_INFINITY;
  return {
    applied: applied.length,
    pending: [ ...known ].filter(when => when > newest).length,
    unknown: applied.filter(createdAt => !known.has(createdAt))
  };
}

/**
 * Refuses a database that has a migration this version does not know (NF-7.3),
 * naming the version that last started on it.
 *
 * @returns the migration state, for the caller that goes on to migrate.
 * @throws NewerSchemaError
 */
export function assertNoNewerMigrations(database: Database, migrationsFolder: string): MigrationState {
  const state = migrationState(database, migrationsFolder);
  if (state.unknown.length > 0) {
    throw new NewerSchemaError(state.unknown, readLastVersion(database));
  }
  return state;
}

/**
 * Applies the pending migrations. Drizzle's migrator runs them all in one
 * transaction, so a migration that fails leaves the database as it was (NF-7.1).
 */
export function applyMigrations(database: Database, migrationsFolder: string): void {
  if (!journalPath(migrationsFolder)) {
    return;
  }
  knownMigrations(migrationsFolder); // validates the journal before Drizzle reads it
  migrate(database.db, { migrationsFolder });
}
