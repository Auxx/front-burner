import { JobRunner, RunningJob } from '@front-burner/server-core-jobs';
import { DATA_LAYOUT, DataLayout, isTrashName } from '@front-burner/server-core-storage';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { DELETE_FOLDER_JOB_TYPE, DeleteFolderJobPayload } from './entry-delete';

/**
 * The **Delete folder** job of A-6 (FB-40): removes a folder that a delete
 * moved into `tmp/`. The user's folder is already gone from the working copy,
 * so a failure is only logged; `tmp/` is emptied on the next start (NF-5.1).
 */
@Injectable()
export class DeleteFolderJob implements OnModuleInit {
  private readonly logger = new Logger(DeleteFolderJob.name);

  constructor(
    private readonly runner: JobRunner,
    @Inject(DATA_LAYOUT) private readonly layout: DataLayout
  ) {}

  onModuleInit(): void {
    this.runner.register<DeleteFolderJobPayload, void>({
      type: DELETE_FOLDER_JOB_TYPE,
      pool: 'housekeeping',
      // The next start empties tmp/ anyway.
      onInterrupted: 'fail',
      handler: job => this.remove(job)
    });
  }

  private async remove(job: RunningJob<DeleteFolderJobPayload>): Promise<void> {
    if (!isTrashName(job.payload.name)) {
      // Never touch the disk for a name this feature did not make.
      throw new Error('Not a trashed folder\'s name');
    }
    try {
      await rm(join(this.layout.tmpDir, job.payload.name), { recursive: true, force: true });
    } catch {
      // The job ID only: the error names the folder's files.
      this.logger.warn(`Delete folder job ${job.id} could not remove its folder`);
    }
  }
}
