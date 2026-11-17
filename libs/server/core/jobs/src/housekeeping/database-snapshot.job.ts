import { CONFIG, Config } from '@front-burner/server-core-config';
import { DATABASE, Database, DatabaseSnapshots, SNAPSHOT_PREFIX } from '@front-burner/server-core-database';
import { DataLayout } from '@front-burner/server-core-storage';
import { HOUR_MS } from '@front-burner/shared-util';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { JobRunner } from '../runner/job-runner';

export interface DatabaseSnapshotResult {
  written: boolean;
  /** How many old snapshots and partial files were removed. */
  pruned: number;
}

/**
 * Housekeeping: the daily database snapshot (NF-6.2, A-4.12). Runs every hour
 * and from the start, and writes a snapshot only when the newest one is
 * `FRONT_BURNER_DB_SNAPSHOT_INTERVAL` old, or there is none. The age of the
 * newest file decides, not a timer, so that a fresh instance has its first
 * snapshot a moment after it starts, a crash loop writes at most one, and a
 * restart never restarts the interval. Every run prunes, so that a lowered
 * `FRONT_BURNER_DB_SNAPSHOT_KEEP` and a crash's partial files take effect
 * within the hour. _(Plan 129's call.)_
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
      new DataLayout(this.config.dataDir).backupsDir,
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

  /**
   * Failures are logged at `error`, paths only at `debug` (NF-10.5), and the
   * next run tries again. A failed prune does not fail the run.
   *
   * @throws the error of a failed snapshot.
   */
  run(): DatabaseSnapshotResult {
    const now = new Date();
    let written = false;
    let writeError: unknown;
    try {
      // A snapshot dated after now (the clock moved back) does not count: one is written now, not every hour.
      const newest = this.snapshots.newest(SNAPSHOT_PREFIX, now);
      if (newest === undefined || now.getTime() - newest.getTime() >= this.config.dbSnapshotIntervalMs) {
        const file = this.snapshots.write(SNAPSHOT_PREFIX, now);
        written = true;
        this.logger.log('Wrote a database snapshot');
        this.logger.debug({ file }, 'Database snapshot file');
      }
    } catch (error) {
      writeError = error;
      this.logger.error({ errorCode: codeOf(error) }, 'Could not write a database snapshot');
      this.logger.debug({ err: error }, 'Database snapshot failure');
    }

    let pruned = 0;
    try {
      const removed = this.snapshots.prune(SNAPSHOT_PREFIX, this.config.dbSnapshotKeep, now);
      pruned = removed.length;
      if (pruned > 0) {
        this.logger.log({ pruned }, 'Pruned database snapshots');
        this.logger.debug({ removed }, 'Pruned database snapshot files');
      }
    } catch (error) {
      this.logger.error({ errorCode: codeOf(error) }, 'Could not prune database snapshots');
      this.logger.debug({ err: error }, 'Database snapshot prune failure');
    }

    if (writeError !== undefined) {
      throw writeError;
    }
    return { written, pruned };
  }
}

function codeOf(error: unknown): string {
  const code = (error as { code?: unknown; } | undefined)?.code;
  return typeof code === 'string' ? code : 'failed';
}
