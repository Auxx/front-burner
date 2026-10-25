import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, assertNoNewerMigrations, NewerSchemaError } from './migrations';
import { Database, openDatabase } from './open-database';

const fixture = (name: string) => join(__dirname, '..', 'test-fixtures', name);

describe('migrations', () => {
  let dir: string;
  let database: Database;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fb-db-'));
    database = openDatabase(join(dir, 'test.db'));
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function journalFolder(content: string): string {
    const folder = mkdtempSync(join(dir, 'journal-'));
    mkdirSync(join(folder, 'meta'));
    writeFileSync(join(folder, 'meta', '_journal.json'), content);
    return folder;
  }

  const tables = () =>
    database.sqlite
      .prepare('SELECT name FROM sqlite_master WHERE type = \'table\'')
      .all()
      .map(row => (row as { name: string; }).name);

  it('applies pending migrations', () => {
    applyMigrations(database, fixture('migrations-two'));

    expect(tables()).toEqual(expect.arrayContaining([ 'a', 'b' ]));
  });

  it('does nothing without a journal', () => {
    const empty = mkdtempSync(join(dir, 'empty-'));

    expect(() => applyMigrations(database, empty)).not.toThrow();
    expect(() => applyMigrations(database, join(dir, 'missing'))).not.toThrow();
    expect(tables()).not.toContain('__drizzle_migrations');
  });

  it('accepts a database migrated by the same or an older version', () => {
    applyMigrations(database, fixture('migrations-one'));

    expect(() => assertNoNewerMigrations(database, fixture('migrations-one'))).not.toThrow();
    expect(() => assertNoNewerMigrations(database, fixture('migrations-two'))).not.toThrow();
  });

  it('accepts a database that was never migrated', () => {
    expect(() => assertNoNewerMigrations(database, fixture('migrations-one'))).not.toThrow();
    expect(() => assertNoNewerMigrations(database, join(dir, 'missing'))).not.toThrow();
  });

  it('refuses a database migrated by a newer version', () => {
    applyMigrations(database, fixture('migrations-two'));

    const error = catchError(() => assertNoNewerMigrations(database, fixture('migrations-one')));

    expect(error).toBeInstanceOf(NewerSchemaError);
    expect((error as NewerSchemaError).unknown).toEqual([ 2000 ]);
  });

  it('names the journal when it is not valid JSON', () => {
    const folder = journalFolder('{ not json');

    expect(() => applyMigrations(database, folder)).toThrow(/_journal\.json is not valid JSON/);
    applyMigrations(database, fixture('migrations-one'));
    expect(() => assertNoNewerMigrations(database, folder)).toThrow(/_journal\.json is not valid JSON/);
  });

  it('names the journal when it has no entries array', () => {
    const folder = journalFolder('{"version":"7"}');

    expect(() => applyMigrations(database, folder)).toThrow(/_journal\.json has no "entries" array/);
    applyMigrations(database, fixture('migrations-one'));
    expect(() => assertNoNewerMigrations(database, folder)).toThrow(/_journal\.json has no "entries" array/);
  });

  it('refuses any applied migration when the folder has none', () => {
    applyMigrations(database, fixture('migrations-two'));

    const error = catchError(() => assertNoNewerMigrations(database, join(dir, 'missing')));

    expect(error).toBeInstanceOf(NewerSchemaError);
    expect((error as NewerSchemaError).unknown).toEqual([ 1000, 2000 ]);
  });
});

function catchError(fn: () => void): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}
