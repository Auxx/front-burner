import { JobRunner, RunningJob } from '@front-burner/server-core-jobs';
import { DATA_LAYOUT, DataLayout, emptyTrashOf, isRemovedName } from '@front-burner/server-core-storage';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

/** The job of **Remove repository** in A-6 (RM-19, RM-21). */
export const DELETE_WORKING_COPY_JOB_TYPE = 'repositories.delete-working-copy';

/** Never a secret, nor anything from the user (A-6.3). */
export interface DeleteWorkingCopyJobPayload {
  repositoryId: number;
  /** The moved working copy's name in `tmp/`, from `newRemovedName`; null when there was none. */
  name: string | null;
}

/**
 * Deletes the working copy of a removed repository from `tmp/`, and the
 * folders deleted from it that are still in the trash (`emptyTrashOf`): their
 * Delete folder jobs went with the repository's rows (A-4.5b). The repository
 * is already gone, so a failure is only logged; `tmp/` is emptied on the next
 * start (NF-5.1).
 */
@Injectable()
export class DeleteWorkingCopyJob implements OnModuleInit {
  private readonly logger = new Logger(DeleteWorkingCopyJob.name);

  constructor(
    private readonly runner: JobRunner,
    @Inject(DATA_LAYOUT) private readonly layout: DataLayout
  ) {}

  onModuleInit(): void {
    this.runner.register<DeleteWorkingCopyJobPayload, void>({
      type: DELETE_WORKING_COPY_JOB_TYPE,
      pool: 'housekeeping',
      // The next start empties tmp/ anyway.
      onInterrupted: 'fail',
      handler: job => this.delete(job)
    });
  }

  private async delete(job: RunningJob<DeleteWorkingCopyJobPayload>): Promise<void> {
    const { repositoryId, name } = job.payload;
    if (
      !Number.isSafeInteger(repositoryId)
      || (name !== null && !(isRemovedName(name) && name.startsWith(`remove-${repositoryId}-`)))
    ) {
      // Never touch the disk for a name this feature did not make.
      throw new Error('Not a removed working copy\'s name');
    }
    try {
      if (name !== null) {
        await rm(join(this.layout.tmpDir, name), { recursive: true, force: true });
      }
      await emptyTrashOf(this.layout, repositoryId);
    } catch {
      // The job ID only: the error names the repository's files.
      this.logger.warn(`Delete working copy job ${job.id} could not delete everything`);
    }
  }
}
