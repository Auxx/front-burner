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

  // NF-9.8: SQLite's own rollback, with no code of ours. `max_page_count` makes
  // SQLite run out of room as on a full disk (SQLITE_FULL, ENOSPC's code).
  it('a failed transaction for ENOSPC changes nothing', () => {
    const opened = openDatabase(join(dir, 'test.db'));
    database = opened;
    const { sqlite } = opened;
    sqlite.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, body BLOB NOT NULL)');
    sqlite.prepare('INSERT INTO notes (body) VALUES (?)').run(Buffer.from('kept'));
    sqlite.pragma(`max_page_count = ${sqlite.pragma('page_count', { simple: true }) as number}`);
    const insert = sqlite.prepare('INSERT INTO notes (body) VALUES (?)');
    const writeBoth = sqlite.transaction(() => {
      insert.run(Buffer.from('small'));
      insert.run(Buffer.alloc(1024 * 1024));
    });

    expect(() => writeBoth()).toThrow(expect.objectContaining({ code: 'SQLITE_FULL' }));

    sqlite.pragma('max_page_count = 1073741823');
    expect(sqlite.prepare('SELECT body FROM notes').all()).toEqual([ { body: Buffer.from('kept') } ]);
    expect(sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
    // Writes go on once there is room again.
    insert.run(Buffer.from('after'));
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM notes').get()).toEqual({ count: 2 });
  });
});
