import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyMigrations,
  assertNoNewerMigrations,
  migrationState,
  NewerSchemaError,
  readLastVersion,
  recordVersion
} from './migrations';
import { Database, openDatabase } from './open-database';

const fixture = (name: string) => join(__dirname, '..', 'test-fixtures', name);
const MIGRATIONS = join(__dirname, '..', '..', 'migrations');

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

  it('a failed migration changes nothing', () => {
    applyMigrations(database, fixture('migrations-one'));
    database.sqlite.exec('INSERT INTO a (id) VALUES (7)');

    expect(() => applyMigrations(database, fixture('migrations-broken'))).toThrow(/missing/);

    expect(tables().sort()).toEqual([ '__drizzle_migrations', 'a' ]);
    expect(database.sqlite.prepare('SELECT id FROM a').pluck().all()).toEqual([ 7 ]);
    expect(migrationState(database, fixture('migrations-broken'))).toEqual({ applied: 1, pending: 2 });
  });

  it('counts the applied and pending migrations', () => {
    expect(migrationState(database, fixture('migrations-two'))).toEqual({ applied: 0, pending: 2 });
    expect(migrationState(database, join(dir, 'missing'))).toEqual({ applied: 0, pending: 0 });

    applyMigrations(database, fixture('migrations-one'));

    expect(migrationState(database, fixture('migrations-two'))).toEqual({ applied: 1, pending: 1 });
    expect(migrationState(database, fixture('migrations-one'))).toEqual({ applied: 1, pending: 0 });
  });
});

describe('the last version', () => {
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

  /** A migrations folder with the real migrations, plus one this version does not know. */
  function newerFolder(): string {
    const folder = join(dir, 'newer');
    cpSync(MIGRATIONS, folder, { recursive: true });
    const journalFile = join(folder, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalFile, 'utf8')) as { entries: Record<string, unknown>[]; };
    const last = journal.entries[journal.entries.length - 1];
    journal.entries.push({ ...last, idx: Number(last['idx']) + 1, when: Number(last['when']) + 1, tag: '9999_future' });
    writeFileSync(journalFile, JSON.stringify(journal));
    writeFileSync(join(folder, '9999_future.sql'), 'CREATE TABLE `future` (`id` integer PRIMARY KEY NOT NULL);');
    return folder;
  }

  it('records the version after migrating', () => {
    applyMigrations(database, MIGRATIONS);
    expect(readLastVersion(database)).toBeNull();

    recordVersion(database, '0.1.0');
    expect(readLastVersion(database)).toBe('0.1.0');
    expect(database.sqlite.prepare('SELECT onboarding_state FROM instance_state').pluck().get()).toBe('required');

    database.sqlite.exec('UPDATE instance_state SET onboarding_state = \'completed\'');
    recordVersion(database, '0.2.0');
    expect(readLastVersion(database)).toBe('0.2.0');
    expect(database.sqlite.prepare('SELECT onboarding_state FROM instance_state').pluck().get()).toBe('completed');
  });

  it('reads no version from a new database or one without the column', () => {
    expect(readLastVersion(database)).toBeNull();

    database.sqlite.exec('CREATE TABLE instance_state (id integer PRIMARY KEY, onboarding_state text NOT NULL)');
    database.sqlite.exec('INSERT INTO instance_state VALUES (1, \'completed\')');

    expect(readLastVersion(database)).toBeNull();
  });

  it('refuses a newer database naming its version', () => {
    applyMigrations(database, newerFolder());
    recordVersion(database, '0.2.0');

    const error = catchError(() => assertNoNewerMigrations(database, MIGRATIONS));

    expect(error).toBeInstanceOf(NewerSchemaError);
    expect((error as NewerSchemaError).lastVersion).toBe('0.2.0');
    expect((error as Error).message).toBe(
      'Database is from version 0.2.0; restore the pre-upgrade snapshot to go back'
    );
  });

  it('refuses a newer database without a recorded version', () => {
    applyMigrations(database, newerFolder());

    const error = catchError(() => assertNoNewerMigrations(database, MIGRATIONS));

    expect(error).toBeInstanceOf(NewerSchemaError);
    expect((error as NewerSchemaError).lastVersion).toBeNull();
    expect((error as Error).message).toBe(
      'Database is from a newer version; restore the pre-upgrade snapshot to go back'
    );
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
