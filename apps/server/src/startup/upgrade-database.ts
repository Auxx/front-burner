import { UNKNOWN_VERSION } from '@front-burner/server-core-config';
import {
  applyMigrations,
  assertNoNewerMigrations,
  Database,
  DatabaseSnapshots,
  readLastVersion,
  recordVersion,
  safeVersion
} from '@front-burner/server-core-database';
import { basename } from 'node:path';

/** The prefix of the pre-upgrade snapshots, which the daily pruning never touches (NF-7.1, A-4.12). */
export const PRE_UPGRADE_PREFIX = 'pre-upgrade';

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
 * A new pre-upgrade snapshot replaces older ones from the same old version,
 * such as those of earlier attempts whose migration failed: the newest is the
 * way back to that version. Those from other old versions are kept.
 *
 * A build without a version (`unknown`) never replaces a recorded version.
 *
 * @returns the snapshot's path, if one was written.
 * @throws NewerSchemaError, or the snapshot's or a migration's error.
 */
export function upgradeDatabase(database: Database, options: UpgradeDatabaseOptions): string | undefined {
  const { migrationsFolder, backupsDir, version, log } = options;
  const { applied, pending } = assertNoNewerMigrations(database, migrationsFolder);
  let snapshot: string | undefined;
  if (pending > 0 && applied > 0) {
    const from = readLastVersion(database) ?? UNKNOWN_VERSION;
    // The snapshot holds the old version's schema, so its name carries that version twice: as the series and the suffix.
    const snapshots = new DatabaseSnapshots(database.sqlite, backupsDir, from);
    const prefix = `${PRE_UPGRADE_PREFIX}-v${safeVersion(from)}`;
    snapshot = snapshots.write(prefix);
    snapshots.prune(prefix, 1);
    // Quoted in the deployment guide (docs/wiki/deployment.md): change both together.
    log(`Upgrading the database from ${from} to ${version}; snapshot backups/${basename(snapshot)}`);
  }
  applyMigrations(database, migrationsFolder);
  if (version !== UNKNOWN_VERSION) {
    recordVersion(database, version);
  }
  return snapshot;
}
