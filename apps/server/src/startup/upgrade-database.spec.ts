import {
  applyMigrations,
  Database,
  DatabaseSnapshots,
  migrationState,
  NewerSchemaError,
  openDatabase,
  readLastVersion,
  recordVersion,
  SNAPSHOT_PREFIX
} from '@front-burner/server-core-database';
import { MIGRATIONS_FOLDER, newerMigrations, previousMigrations } from '@front-burner/server-core-database/testing';
import BetterSqlite3 from 'better-sqlite3';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { upgradeDatabase } from './upgrade-database';

describe('upgradeDatabase', () => {
  let dir: string;
  let backupsDir: string;
  let database: Database;
  let logs: string[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fb-upgrade-'));
    backupsDir = join(dir, 'backups');
    database = openDatabase(join(dir, 'front-burner.sqlite'));
    logs = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const upgrade = (migrationsFolder: string, version = '0.2.0') =>
    upgradeDatabase(database, { migrationsFolder, backupsDir, version, log: message => void logs.push(message) });

  const hasTable = (sqlite: BetterSqlite3.Database, name: string) =>
    sqlite.prepare('SELECT 1 FROM sqlite_master WHERE type = \'table\' AND name = ?').get(name) !== undefined;

  const backups = () => existsSync(backupsDir) ? readdirSync(backupsDir).sort() : [];

  /** A database at version 0.1.0 with every real migration. */
  const atOldVersion = () => {
    applyMigrations(database, MIGRATIONS_FOLDER);
    recordVersion(database, '0.1.0');
  };

  it('writes a pre-upgrade snapshot named after the old version before migrating', () => {
    atOldVersion();

    const snapshot = upgrade(newerMigrations(dir));

    expect(backups()).toHaveLength(1);
    expect(backups()[0]).toMatch(/^pre-upgrade-v0\.1\.0-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\dZ-v0\.1\.0\.sqlite$/);
    expect(snapshot).toBe(join(backupsDir, backups()[0]));
    const copy = new BetterSqlite3(join(backupsDir, backups()[0]), { readonly: true });
    try {
      expect(hasTable(copy, 'future')).toBe(false);
      expect(copy.prepare('SELECT last_version FROM instance_state').pluck().get()).toBe('0.1.0');
    } finally {
      copy.close();
    }
    expect(hasTable(database.sqlite, 'future')).toBe(true);
    expect(readLastVersion(database)).toBe('0.2.0');
    expect(logs).toEqual([ `Upgrading the database from 0.1.0 to 0.2.0; snapshot backups/${backups()[0]}` ]);
  });

  it('names the snapshot of a database without a recorded version "vunknown"', () => {
    applyMigrations(database, previousMigrations(dir));

    upgrade(MIGRATIONS_FOLDER);

    expect(backups()).toEqual([ expect.stringMatching(/^pre-upgrade-vunknown-.*-vunknown\.sqlite$/) ]);
    expect(logs[0]).toMatch(/^Upgrading the database from unknown to 0\.2\.0; snapshot backups\/pre-upgrade-vunknown-/);
    expect(readLastVersion(database)).toBe('0.2.0');
  });

  it('a new database gets no snapshot', () => {
    expect(upgrade(MIGRATIONS_FOLDER)).toBeUndefined();

    expect(backups()).toEqual([]);
    expect(logs).toEqual([]);
    expect(migrationState(database, MIGRATIONS_FOLDER).pending).toBe(0);
    expect(readLastVersion(database)).toBe('0.2.0');
  });

  it('no pending migration, no snapshot', () => {
    atOldVersion();

    expect(upgrade(MIGRATIONS_FOLDER, '0.1.1')).toBeUndefined();

    expect(backups()).toEqual([]);
    expect(logs).toEqual([]);
    expect(readLastVersion(database)).toBe('0.1.1');
  });

  it('a migration the migrator would skip writes no snapshot', () => {
    atOldVersion();
    // As two branches merged out of order: a migration older than the newest applied one.
    const folder = newerMigrations(dir);
    writeFileSync(
      join(folder, 'meta', '_journal.json'),
      JSON.stringify({
        version: '7',
        dialect: 'sqlite',
        entries: [
          { idx: 0, version: '6', when: 1, tag: '9999_future', breakpoints: true },
          ...(migrationJournal(MIGRATIONS_FOLDER).entries)
        ]
      })
    );

    expect(upgrade(folder)).toBeUndefined();

    expect(backups()).toEqual([]);
    expect(logs).toEqual([]);
  });

  it('a failed snapshot stops the start before migrating', () => {
    atOldVersion();
    // As a full disk: the snapshot cannot be written.
    writeFileSync(backupsDir, 'not a folder');
    const folder = newerMigrations(dir);

    expect(() => upgrade(folder)).toThrow();

    expect(hasTable(database.sqlite, 'future')).toBe(false);
    expect(migrationState(database, folder)).toMatchObject({ pending: 1 });
    expect(readLastVersion(database)).toBe('0.1.0');
    expect(logs).toEqual([]);
  });

  it('a retry after a failed migration replaces its snapshot and keeps other versions\' ones', () => {
    atOldVersion();
    const folder = newerMigrations(dir);
    writeFileSync(join(folder, '9999_future.sql'), 'INSERT INTO `missing` (`id`) VALUES (1);');
    const older = new DatabaseSnapshots(database.sqlite, backupsDir, '0.0.9').write('pre-upgrade-v0.0.9');
    vi.useFakeTimers({ toFake: [ 'Date' ] });

    vi.setSystemTime(new Date('2026-11-17T09:00:00Z'));
    expect(() => upgrade(folder)).toThrow(/missing/);
    vi.setSystemTime(new Date('2026-11-17T09:00:05Z'));
    expect(() => upgrade(folder)).toThrow(/missing/);

    expect(backups()).toEqual([
      expect.stringMatching(/^pre-upgrade-v0\.0\.9-/),
      'pre-upgrade-v0.1.0-2026-11-17T09-00-05Z-v0.1.0.sqlite'
    ]);
    expect(join(backupsDir, backups()[0])).toBe(older);
    expect(readLastVersion(database)).toBe('0.1.0');
  });

  it('a build without a version keeps the recorded version', () => {
    atOldVersion();

    upgrade(newerMigrations(dir), 'unknown');

    expect(readLastVersion(database)).toBe('0.1.0');
  });

  it('refuses a newer database naming its version, before any snapshot', () => {
    applyMigrations(database, newerMigrations(dir));
    recordVersion(database, '0.3.0');

    expect(() => upgrade(MIGRATIONS_FOLDER)).toThrow(new NewerSchemaError([], '0.3.0').message);

    expect(backups()).toEqual([]);
    expect(readLastVersion(database)).toBe('0.3.0');
  });

  it('the daily pruning leaves pre-upgrade snapshots', () => {
    atOldVersion();
    upgrade(newerMigrations(dir));
    const daily = new DatabaseSnapshots(database.sqlite, backupsDir, '0.2.0');
    daily.write(SNAPSHOT_PREFIX);

    daily.prune(SNAPSHOT_PREFIX, 0);

    expect(backups()).toEqual([ expect.stringMatching(/^pre-upgrade-v0\.1\.0-/) ]);
  });
});

function migrationJournal(folder: string): { entries: unknown[]; } {
  return JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')) as { entries: unknown[]; };
}
