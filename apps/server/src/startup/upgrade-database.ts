import {
  applyMigrations,
  assertNoNewerMigrations,
  Database,
  DatabaseSnapshots,
  migrationState,
  readLastVersion,
  recordVersion
} from '@front-burner/server-core-database';
import { basename } from 'node:path';

/** The prefix of the pre-upgrade snapshots, which are never pruned (NF-7.1, A-4.12). */
export const PRE_UPGRADE_PREFIX = 'pre-upgrade';

/** The old version of a database from before `last_version` existed. */
const UNKNOWN_OLD_VERSION = 'unknown';

export interface UpgradeDatabaseOptions {
  migrationsFolder: string;
  /** `DataLayout.backupsDir`. */
  backupsDir: string;
  /** The version starting now (`Config.version`). */
  version: string;
  log: (message: string) => void;
}

/**
 * The migrations step of A-1.11: refuses a newer database (NF-7.3); when
 * migrations are pending and the database is not new, writes a pre-upgrade
 * snapshot named after the old version; then migrates (NF-7.1) and records
 * this version. A snapshot that fails stops before any migration, so that an
 * upgrade never runs without its way back.
 *
 * @returns the snapshot's path, if one was written.
 * @throws NewerSchemaError, or the snapshot's or a migration's error.
 */
export function upgradeDatabase(database: Database, options: UpgradeDatabaseOptions): string | undefined {
  const { migrationsFolder, backupsDir, version, log } = options;
  assertNoNewerMigrations(database, migrationsFolder);
  const { applied, pending } = migrationState(database, migrationsFolder);
  let snapshot: string | undefined;
  if (pending > 0 && applied > 0) {
    const from = readLastVersion(database) ?? UNKNOWN_OLD_VERSION;
    // The snapshot holds the old version's schema, so its name carries that version twice: as the series and the suffix.
    const snapshots = new DatabaseSnapshots(database.sqlite, backupsDir, from);
    const prefix = `${PRE_UPGRADE_PREFIX}-v${from.replace(/[^\w.+-]/g, '_')}`;
    snapshot = snapshots.write(prefix);
    log(`Upgrading the database from ${from} to ${version}; snapshot backups/${basename(snapshot)}`);
  }
  applyMigrations(database, migrationsFolder);
  recordVersion(database, version);
  return snapshot;
}
