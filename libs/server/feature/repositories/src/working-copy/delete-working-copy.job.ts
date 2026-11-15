import { JobRunner, RunningJob } from '@front-burner/server-core-jobs';
import { DATA_LAYOUT, DataLayout, emptyTrashOf, isRemovedName } from '@front-burner/server-core-storage';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

/** The job of **Remove repository** in A-6 (RM-19, RM-21), also queued by **Clone again** (RM-12). */
export const DELETE_WORKING_COPY_JOB_TYPE = 'repositories.delete-working-copy';

/** Never a secret, nor anything from the user (A-6.3). */
export interface DeleteWorkingCopyJobPayload {
  repositoryId: number;
  /** The moved working copy's name in `tmp/`, from `newRemovedName`; null when there was none. */
  name: string | null;
  /**
   * Whether to delete the repository's trashed folders too: for a removed
   * repository, whose Delete folder jobs went with its rows (A-4.5b). Not for
   * one cloned again, whose Delete folder jobs still run, and whose new working
   * copy may have trashed folders of its own by then. A job queued before this
   * was recorded empties the trash.
   */
  emptyTrash?: boolean;
}

/**
 * Deletes a working copy moved into `tmp/`, by removing its repository or
 * cloning it again, and for a removed repository its trashed folders
 * (`emptyTrashOf`). Nothing waits for it, so a failure is only logged; `tmp/`
 * is emptied on the next start (NF-5.1).
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
    const { repositoryId, name, emptyTrash = true } = job.payload;
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
      if (emptyTrash) {
        await emptyTrashOf(this.layout, repositoryId);
      }
    } catch {
      // The job ID only: the error names the repository's files.
      this.logger.warn(`Delete working copy job ${job.id} could not delete everything`);
    }
  }
}
