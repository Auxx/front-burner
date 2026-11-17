import type { Config } from '@front-burner/server-core-config';
import { Database, DatabaseSnapshots } from '@front-burner/server-core-database';
import type { EventsHub } from '@front-burner/server-core-events';
import { Logger } from '@nestjs/common';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobRunner } from '../runner/job-runner';
import { JobTypeDefinition, RunningJob } from '../runner/job-types';
import { createTestDatabase } from '../testing/test-database';
import { DatabaseSnapshotJob } from './database-snapshot.job';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const START = new Date('2026-11-17T09:30:00Z');

describe('DatabaseSnapshotJob', () => {
  let dataDir: string;
  let backups: string;
  let database: Database;
  let runner: JobRunner;
  let config: Pick<Config, 'dataDir' | 'version' | 'dbSnapshotIntervalMs' | 'dbSnapshotKeep'>;

  const files = () => readdirSync(backups).sort();

  /** A fresh job, as after a start, and its registered definition. */
  const start = () => {
    runner = new JobRunner(database, { cloneConcurrency: 2 } as Config, { publish: vi.fn() } as unknown as EventsHub);
    const register = vi.spyOn(runner, 'register');
    new DatabaseSnapshotJob(database, config as Config, runner).onModuleInit();
    return register.mock.calls[0][0] as JobTypeDefinition<unknown, { written: boolean; pruned: number; }>;
  };

  const run = (definition: JobTypeDefinition<unknown, { written: boolean; pruned: number; }>) =>
    definition.handler({ payload: {} } as RunningJob);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: [ 'Date' ] });
    vi.setSystemTime(START);
    dataDir = mkdtempSync(join(tmpdir(), 'fb-snapshot-job-'));
    backups = join(dataDir, 'backups');
    mkdirSync(backups);
    database = createTestDatabase();
    config = { dataDir, version: '1.4.2', dbSnapshotIntervalMs: DAY, dbSnapshotKeep: 7 };
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(dataDir, { recursive: true, force: true });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('registers database.snapshot every hour', () => {
    expect(start()).toMatchObject({
      type: 'database.snapshot',
      pool: 'housekeeping',
      onInterrupted: 'requeue',
      repeatEveryMs: HOUR
    });
    // The first run is at once, so that a fresh instance has a snapshot a moment after it starts.
    expect(start().spreadOnStart).toBeFalsy();
  });

  it('writes a snapshot at the first run when there is none', async () => {
    expect(await run(start())).toEqual({ written: true, pruned: 0 });

    expect(files()).toEqual([ 'front-burner-2026-11-17T09-30-00Z-v1.4.2.sqlite' ]);
  });

  it('skips a run while the newest snapshot is younger than the interval', async () => {
    const definition = start();
    await run(definition);
    vi.setSystemTime(START.getTime() + DAY - 1000);

    expect(await run(definition)).toEqual({ written: false, pruned: 0 });

    expect(files()).toHaveLength(1);
  });

  it('writes once the newest is older than the interval, and prunes', async () => {
    config.dbSnapshotKeep = 3;
    const definition = start();
    for (let day = 0; day < 3; day++) {
      vi.setSystemTime(START.getTime() + day * DAY);
      await run(definition);
    }
    vi.setSystemTime(START.getTime() + 3 * DAY);

    expect(await run(definition)).toEqual({ written: true, pruned: 1 });

    expect(files()).toEqual([
      'front-burner-2026-11-18T09-30-00Z-v1.4.2.sqlite',
      'front-burner-2026-11-19T09-30-00Z-v1.4.2.sqlite',
      'front-burner-2026-11-20T09-30-00Z-v1.4.2.sqlite'
    ]);
  });

  it('restarts in a loop write one snapshot', async () => {
    for (let restart = 0; restart < 10; restart++) {
      vi.setSystemTime(START.getTime() + restart * 60_000);
      await run(start());
    }

    expect(files()).toEqual([ 'front-burner-2026-11-17T09-30-00Z-v1.4.2.sqlite' ]);
  });

  it('writes one, not one an hour, when the newest is in the future, as after the clock moved back', async () => {
    const ahead = 'front-burner-2027-01-01T00-00-00Z-v1.4.2.sqlite';
    writeFileSync(join(backups, ahead), '');
    const definition = start();

    expect(await run(definition)).toEqual({ written: true, pruned: 0 });
    for (let hour = 1; hour < 24; hour++) {
      vi.setSystemTime(START.getTime() + hour * HOUR);
      expect(await run(definition)).toEqual({ written: false, pruned: 0 });
    }

    expect(files()).toEqual([ 'front-burner-2026-11-17T09-30-00Z-v1.4.2.sqlite', ahead ]);
  });

  it('prunes the snapshot dated in the future before the daily ones', async () => {
    config.dbSnapshotKeep = 2;
    writeFileSync(join(backups, 'front-burner-2027-01-01T00-00-00Z-v1.4.2.sqlite'), '');
    const definition = start();
    for (let day = 0; day < 3; day++) {
      vi.setSystemTime(START.getTime() + day * DAY);
      await run(definition);
    }

    expect(files()).toEqual([
      'front-burner-2026-11-18T09-30-00Z-v1.4.2.sqlite',
      'front-burner-2026-11-19T09-30-00Z-v1.4.2.sqlite'
    ]);
  });

  it('prunes at every run, so that a lowered count takes effect within the hour', async () => {
    for (let day = 0; day < 5; day++) {
      vi.setSystemTime(START.getTime() + day * DAY);
      await run(start());
    }
    writeFileSync(join(backups, 'front-burner-2026-11-20T00-00-00Z-v1.4.2.sqlite.partial'), 'half a database');
    config.dbSnapshotKeep = 2;
    vi.setSystemTime(START.getTime() + 4 * DAY + HOUR);

    expect(await run(start())).toEqual({ written: false, pruned: 4 });

    expect(files()).toEqual([
      'front-burner-2026-11-20T09-30-00Z-v1.4.2.sqlite',
      'front-burner-2026-11-21T09-30-00Z-v1.4.2.sqlite'
    ]);
  });

  it('logs a failed prune as such, and keeps the snapshot it wrote', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(DatabaseSnapshots.prototype, 'prune').mockImplementation(() => {
      throw Object.assign(new Error(`EACCES: permission denied, unlink '${backups}/x'`), { code: 'EACCES' });
    });

    expect(await run(start())).toEqual({ written: true, pruned: 0 });

    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith({ errorCode: 'EACCES' }, 'Could not prune database snapshots');
    expect(files()).toEqual([ 'front-burner-2026-11-17T09-30-00Z-v1.4.2.sqlite' ]);
  });

  it('logs a failed snapshot at error, without its path, and fails the run', () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(DatabaseSnapshots.prototype, 'write').mockImplementation(() => {
      throw Object.assign(new Error(`ENOSPC: no space left on device, write '${backups}/x'`), { code: 'ENOSPC' });
    });

    // The runner calls the handler inside a promise chain, so a throw fails the job.
    expect(() => run(start())).toThrow('ENOSPC');

    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith({ errorCode: 'ENOSPC' }, 'Could not write a database snapshot');
  });
});
