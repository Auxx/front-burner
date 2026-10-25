import BetterSqlite3 from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Database, openDatabase } from './open-database';

describe('openDatabase', () => {
  let dir: string;
  let database: Database | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fb-db-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    database?.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('sets the pragmas', () => {
    const opened = openDatabase(join(dir, 'test.db'));
    database = opened;
    const pragma = (name: string) => opened.sqlite.pragma(name, { simple: true });

    expect(pragma('journal_mode')).toBe('wal');
    expect(pragma('foreign_keys')).toBe(1);
    expect(pragma('synchronous')).toBe(1);
    expect(pragma('busy_timeout')).toBe(5000);
  });

  it('closes the connection when a pragma fails', () => {
    const file = join(dir, 'not-a-database.db');
    writeFileSync(file, 'this is not a SQLite database, but it is long enough to be read as one'.repeat(100));
    const close = vi.spyOn(BetterSqlite3.prototype, 'close');

    expect(() => openDatabase(file)).toThrow();

    expect(close).toHaveBeenCalledTimes(1);
  });
});
