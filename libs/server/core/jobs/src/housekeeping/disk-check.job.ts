import { DiskMonitor } from '@front-burner/server-core-storage';
import { MINUTE_MS } from '@front-burner/shared-util';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobRunner } from '../runner/job-runner';

/**
 * Housekeeping: reads free disk space every minute for the low-space rules
 * (NF-9.7) _(plan 131's call: a disk fills slowly, and a minute is short next
 * to the time a clone takes)_. The monitor checked once on start already; its
 * first run, at once, is cheap.
 */
@Injectable()
export class DiskCheckJob implements OnModuleInit {
  constructor(private readonly disks: DiskMonitor, private readonly runner: JobRunner) {}

  onModuleInit(): void {
    this.runner.register({
      type: 'storage.disk-check',
      pool: 'housekeeping',
      onInterrupted: 'requeue',
      repeatEveryMs: MINUTE_MS,
      handler: () => this.disks.check()
    });
  }
}
