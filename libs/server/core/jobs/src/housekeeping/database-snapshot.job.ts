import { CONFIG, Config } from '@front-burner/server-core-config';
import {
  backupsDirOf,
  DATABASE,
  Database,
  DatabaseSnapshots,
  SNAPSHOT_PREFIX
} from '@front-burner/server-core-database';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { JobRunner } from '../runner/job-runner';

const HOUR_MS = 3_600_000;

export interface DatabaseSnapshotResult {
  written: boolean;
  /** How many old snapshots were removed. */
  pruned: number;
}

/**
 * Housekeeping: the daily database snapshot (NF-6.2, A-4.12). Runs every hour
 * and from the start, and writes a snapshot only when the newest one is
 * `FRONT_BURNER_DB_SNAPSHOT_INTERVAL` old, or there is none. The age of the
 * newest file decides, not a timer, so that a fresh instance has its first
 * snapshot a moment after it starts, a crash loop writes at most one, and a
 * restart never restarts the interval. _(Plan 129's call.)_
 */
@Injectable()
export class DatabaseSnapshotJob implements OnModuleInit {
  private readonly logger = new Logger(DatabaseSnapshotJob.name);
  private snapshotsOrUndefined: DatabaseSnapshots | undefined;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CONFIG) private readonly config: Pick<
      Config,
      'dataDir' | 'version' | 'dbSnapshotIntervalMs' | 'dbSnapshotKeep'
    >,
    private readonly runner: JobRunner
  ) {}

  /** Made at the first run, so that the module can be built from a configuration without a data directory. */
  private get snapshots(): DatabaseSnapshots {
    this.snapshotsOrUndefined ??= new DatabaseSnapshots(
      this.database.sqlite,
      backupsDirOf(this.config.dataDir),
      this.config.version
    );
    return this.snapshotsOrUndefined;
  }

  onModuleInit(): void {
    this.runner.register({
      type: 'database.snapshot',
      pool: 'housekeeping',
      onInterrupted: 'requeue',
      repeatEveryMs: HOUR_MS,
      handler: () => Promise.resolve(this.run())
    });
  }

  /** @throws the error of a failed snapshot, logged at `error`; the next run tries again. */
  run(): DatabaseSnapshotResult {
    try {
      const newest = this.snapshots.newest(SNAPSHOT_PREFIX);
      const age = newest === undefined ? Number.POSITIVE_INFINITY : Date.now() - newest.getTime();
      // A newest snapshot in the future means the clock moved back: write one rather than none until it catches up.
      if (age >= 0 && age < this.config.dbSnapshotIntervalMs) {
        return { written: false, pruned: 0 };
      }
      const file = this.snapshots.write(SNAPSHOT_PREFIX);
      const pruned = this.snapshots.prune(SNAPSHOT_PREFIX, this.config.dbSnapshotKeep);
      this.logger.log({ pruned: pruned.length }, 'Wrote a database snapshot');
      this.logger.debug({ file, pruned }, 'Database snapshot files');
      return { written: true, pruned: pruned.length };
    } catch (error) {
      // Paths only at debug (NF-10.5): file system errors name them.
      this.logger.error({ errorCode: codeOf(error) }, 'Could not write a database snapshot');
      this.logger.debug({ err: error }, 'Database snapshot failure');
      throw error;
    }
  }
}

function codeOf(error: unknown): string {
  const code = (error as { code?: unknown; } | undefined)?.code;
  return typeof code === 'string' ? code : 'failed';
}
