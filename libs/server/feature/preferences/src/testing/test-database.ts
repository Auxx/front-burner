import { applyMigrations, Database, openDatabase } from '@front-burner/server-core-database';
import { join } from 'node:path';

const MIGRATIONS = join(__dirname, '..', '..', '..', '..', 'core', 'database', 'migrations');

/** A migrated in-memory database for this library's specs; close it with `database.sqlite.close()`. */
export function createTestDatabase(): Database {
  const database = openDatabase(':memory:');
  applyMigrations(database, MIGRATIONS);
  return database;
}
