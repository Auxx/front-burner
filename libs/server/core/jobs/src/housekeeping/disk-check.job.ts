import { DiskMonitor } from '@front-burner/server-core-storage';
import { MINUTE_MS } from '@front-burner/shared-util';
import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { JobRunner } from '../runner/job-runner';

/**
 * Housekeeping: reads free disk space every minute for the low-space rules
 * (NF-9.7) _(plan 131's call: a disk fills slowly, and a minute is short next
 * to the time a clone takes)_. The monitor checked once on start already; its
 * first run, at once, is cheap.
 *
 * The monitor comes from the global `StorageModule`, which the backend always
 * has; a module built without it, such as a feature's test, has no disk check,
 * so that it needs no data directory (as `DatabaseSnapshotJob`).
 */
@Injectable()
export class DiskCheckJob implements OnModuleInit {
  constructor(
    @Optional() @Inject(DiskMonitor) private readonly disks: DiskMonitor | undefined,
    private readonly runner: JobRunner
  ) {}

  onModuleInit(): void {
    const disks = this.disks;
    if (disks === undefined) {
      return;
    }
    this.runner.register({
      type: 'storage.disk-check',
      pool: 'housekeeping',
      onInterrupted: 'requeue',
      repeatEveryMs: MINUTE_MS,
      handler: () => disks.check()
    });
  }
}
