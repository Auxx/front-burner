import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Database, openDatabase } from './open-database';

describe('openDatabase', () => {
  let dir: string;
  let database: Database;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fb-db-'));
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('sets the pragmas', () => {
    database = openDatabase(join(dir, 'test.db'));
    const pragma = (name: string) => database.sqlite.pragma(name, { simple: true });

    expect(pragma('journal_mode')).toBe('wal');
    expect(pragma('foreign_keys')).toBe(1);
    expect(pragma('synchronous')).toBe(1);
    expect(pragma('busy_timeout')).toBe(5000);
  });
});
