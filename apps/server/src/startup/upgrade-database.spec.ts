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
import BetterSqlite3 from 'better-sqlite3';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { upgradeDatabase } from './upgrade-database';

const MIGRATIONS = join(__dirname, '..', '..', '..', '..', 'libs', 'server', 'core', 'database', 'migrations');

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

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
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const upgrade = (migrationsFolder: string, version = '0.2.0') =>
    upgradeDatabase(database, { migrationsFolder, backupsDir, version, log: message => void logs.push(message) });

  /** A copy of the real migrations, its journal changed by `edit`. */
  function migrationsCopy(name: string, edit: (entries: JournalEntry[]) => JournalEntry[]): string {
    const folder = join(dir, name);
    cpSync(MIGRATIONS, folder, { recursive: true });
    const file = join(folder, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(file, 'utf8')) as { entries: JournalEntry[]; };
    journal.entries = edit(journal.entries);
    writeFileSync(file, JSON.stringify(journal));
    return folder;
  }

  /** The real migrations and one more, which creates the table `future`. */
  const withFuture = () => {
    const folder = migrationsCopy('newer', entries => {
      const last = entries[entries.length - 1];
      return [ ...entries, { ...last, idx: last.idx + 1, when: last.when + 1, tag: '9999_future' } ];
    });
    writeFileSync(join(folder, '9999_future.sql'), 'CREATE TABLE `future` (`id` integer PRIMARY KEY NOT NULL);');
    return folder;
  };

  /** Every real migration but the last: the schema of the previous version. */
  const previous = () => migrationsCopy('previous', entries => entries.slice(0, -1));

  const hasTable = (sqlite: BetterSqlite3.Database, name: string) =>
    sqlite.prepare('SELECT 1 FROM sqlite_master WHERE type = \'table\' AND name = ?').get(name) !== undefined;

  const backups = () => existsSync(backupsDir) ? readdirSync(backupsDir) : [];

  it('writes a pre-upgrade snapshot named after the old version before migrating', () => {
    applyMigrations(database, MIGRATIONS);
    recordVersion(database, '0.1.0');

    const snapshot = upgrade(withFuture());

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
    applyMigrations(database, previous());

    upgrade(MIGRATIONS);

    expect(backups()).toEqual([ expect.stringMatching(/^pre-upgrade-vunknown-.*-vunknown\.sqlite$/) ]);
    expect(logs[0]).toMatch(/^Upgrading the database from unknown to 0\.2\.0; snapshot backups\/pre-upgrade-vunknown-/);
    expect(readLastVersion(database)).toBe('0.2.0');
  });

  it('a new database gets no snapshot', () => {
    expect(upgrade(MIGRATIONS)).toBeUndefined();

    expect(backups()).toEqual([]);
    expect(logs).toEqual([]);
    expect(migrationState(database, MIGRATIONS).pending).toBe(0);
    expect(readLastVersion(database)).toBe('0.2.0');
  });

  it('no pending migration, no snapshot', () => {
    applyMigrations(database, MIGRATIONS);
    recordVersion(database, '0.1.0');

    expect(upgrade(MIGRATIONS, '0.1.1')).toBeUndefined();

    expect(backups()).toEqual([]);
    expect(logs).toEqual([]);
    expect(readLastVersion(database)).toBe('0.1.1');
  });

  it('a failed snapshot stops the start before migrating', () => {
    applyMigrations(database, MIGRATIONS);
    recordVersion(database, '0.1.0');
    // As a full disk: the snapshot cannot be written.
    writeFileSync(backupsDir, 'not a folder');
    const folder = withFuture();

    expect(() => upgrade(folder)).toThrow();

    expect(hasTable(database.sqlite, 'future')).toBe(false);
    expect(migrationState(database, folder)).toMatchObject({ pending: 1 });
    expect(readLastVersion(database)).toBe('0.1.0');
    expect(logs).toEqual([]);
  });

  it('refuses a newer database naming its version, before any snapshot', () => {
    applyMigrations(database, withFuture());
    recordVersion(database, '0.3.0');

    expect(() => upgrade(MIGRATIONS)).toThrow(
      new NewerSchemaError([], '0.3.0').message
    );

    expect(backups()).toEqual([]);
    expect(readLastVersion(database)).toBe('0.3.0');
  });

  it('the daily pruning leaves pre-upgrade snapshots', () => {
    applyMigrations(database, MIGRATIONS);
    recordVersion(database, '0.1.0');
    upgrade(withFuture());
    const daily = new DatabaseSnapshots(database.sqlite, backupsDir, '0.2.0');
    daily.write(SNAPSHOT_PREFIX);

    daily.prune(SNAPSHOT_PREFIX, 0);

    expect(backups()).toEqual([ expect.stringMatching(/^pre-upgrade-v0\.1\.0-/) ]);
  });
});
