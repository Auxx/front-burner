import BetterSqlite3 from 'better-sqlite3';
import { BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../schema';

/** The instance's one SQLite connection and its Drizzle wrapper (A-4.1). */
export interface Database {
  sqlite: BetterSqlite3.Database;
  db: BetterSQLite3Database<typeof schema>;
}

export function openDatabase(file: string): Database {
  const sqlite = new BetterSqlite3(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('busy_timeout = 5000');
  return { sqlite, db: drizzle(sqlite, { schema }) };
}
