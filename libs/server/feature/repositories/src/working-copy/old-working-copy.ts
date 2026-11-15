import { JobRunner } from '@front-burner/server-core-jobs';
import { DataLayout, newRemovedName } from '@front-burner/server-core-storage';
import { Logger } from '@nestjs/common';
import { mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { DELETE_WORKING_COPY_JOB_TYPE, DeleteWorkingCopyJobPayload } from './delete-working-copy.job';

/**
 * Moves a working copy into `tmp/` with one rename (NF-5.3), under a name made
 * from the ID only (A-6.3), for removing a repository (RM-19) or cloning it
 * again (RM-12). A repository whose clone never finished has none: null.
 * `tmp/` is emptied on every start (NF-5.1), so a restart before the delete
 * job ran leaves nothing behind.
 */
export async function moveWorkingCopy(
  layout: DataLayout,
  userId: number,
  repositoryId: number
): Promise<string | null> {
  const name = newRemovedName(repositoryId);
  await mkdir(layout.tmpDir, { recursive: true });
  try {
    await rename(layout.workingCopy(userId, repositoryId), join(layout.tmpDir, name));
    return name;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/** Puts back a working copy that `moveWorkingCopy` moved, when what followed failed. */
export async function restoreWorkingCopy(
  layout: DataLayout,
  logger: Logger,
  userId: number,
  repositoryId: number,
  name: string | null
): Promise<void> {
  if (name === null) {
    return;
  }
  try {
    await rename(join(layout.tmpDir, name), layout.workingCopy(userId, repositoryId));
  } catch (error) {
    logger.error(
      { err: error },
      `Could not put back the working copy of repository ${repositoryId}; it is in tmp/ until the next start`
    );
  }
}

/**
 * Queues the job that deletes the moved working copy, and with `emptyTrash`
 * the repository's trashed folders (see `DeleteWorkingCopyJobPayload`). One
 * that cannot be queued does not fail the request: `tmp/` is emptied on the
 * next start (NF-5.1).
 */
export function queueWorkingCopyDeletion(
  runner: JobRunner,
  logger: Logger,
  payload: DeleteWorkingCopyJobPayload
): void {
  const { repositoryId } = payload;
  try {
    runner.enqueue({
      type: DELETE_WORKING_COPY_JOB_TYPE,
      // Neither a user nor a repository: the end is nobody's business, and a removed repository's row is gone.
      payload
    });
  } catch {
    logger.warn(
      `Could not queue the deletion of the old working copy of repository ${repositoryId}; tmp/ is emptied on the next start`
    );
  }
}
