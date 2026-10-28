import { EventsHub } from '@front-burner/server-core-events';
import { GitEngine } from '@front-burner/server-core-git';
import { JobRunner } from '@front-burner/server-core-jobs';
import { DATA_LAYOUT, DataLayout, newTrashName, PathRefusedError } from '@front-burner/server-core-storage';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { lstat, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { entryNotDeletable, toFilesError } from '../files/files-errors';
import { splitPath } from '../paths/entry-paths';
import { openFolder, resolveEntry } from '../paths/existing-entry';
import { OpenableRepository } from '../repository/openable-repository';
import { WorkingTreeGuard } from './working-tree-guard';

/** The **Delete folder** job of A-6 (FB-40). */
export const DELETE_FOLDER_JOB_TYPE = 'files.delete-folder';

export interface DeleteFolderJobPayload {
  /** The trashed folder's name in `tmp/`, from `newTrashName`; never derived from the user's path (A-6.3). */
  name: string;
}

/**
 * Deletes entries of a working copy (FB-37, FB-40). Changes only the working
 * tree: nothing is staged or committed (D-1.2).
 */
@Injectable()
export class EntryDelete {
  private readonly logger = new Logger(EntryDelete.name);

  constructor(
    private readonly repositories: OpenableRepository,
    private readonly guard: WorkingTreeGuard,
    private readonly git: GitEngine,
    private readonly jobs: JobRunner,
    private readonly events: EventsHub,
    @Inject(DATA_LAYOUT) private readonly layout: DataLayout
  ) {}

  /**
   * **Delete** a file of any kind, a symbolic link (never what it points to)
   * or a folder. A folder is moved into `tmp/` with one rename, so it is gone
   * from the working copy at once, and a job removes it there (FB-40, NF-5.3).
   */
  async delete(userId: number, repositoryId: number, path: string): Promise<void> {
    const root = this.repositories.root(userId, repositoryId);
    if (path === '') {
      throw entryNotDeletable();
    }
    const [ parent, name ] = splitPath(path);
    const trashed = await this.guard.change(repositoryId, root, async () => {
      const { entry, submodule } = await resolveEntry(this.git, root, path);
      // A submodule is never deleted, not even with the folder that holds it (FB-23).
      if (submodule || (entry.type === 'folder' && await this.git.holdsSubmodule(root, path))) {
        throw entryNotDeletable();
      }
      // Through the parent's descriptor: a folder on the way swapped for a link
      // after the check cannot redirect the change outside the working copy (A-7.6).
      const folder = await openFolder(this.git, root, parent);
      try {
        const target = join(folder.path, name);
        const stats = await lstat(target).catch(() => {
          throw new PathRefusedError('not-found');
        });
        if (!stats.isDirectory()) {
          // unlink never follows a link: only the link itself goes (AC-FILE-001.11).
          await unlink(target);
          return null;
        }
        const trash = newTrashName(repositoryId);
        await rename(target, join(this.layout.tmpDir, trash));
        return trash;
      } finally {
        await folder.handle.close();
      }
    }).catch(toFilesError);
    if (trashed !== null) {
      this.queueRemoval(repositoryId, trashed);
    }
    // A deleted folder's path is named too, so that clients drop what they listed under it (FB-41).
    this.events.publish(userId, {
      type: 'files.changed',
      repositoryId,
      folders: [ parent, ...(trashed === null ? [] : [ path ]) ]
    });
  }

  /**
   * The folder is already gone from the working copy, so a job that cannot be
   * queued does not fail the delete: `tmp/` is emptied on the next start (NF-5.1).
   */
  private queueRemoval(repositoryId: number, name: string): void {
    try {
      this.jobs.enqueue({
        type: DELETE_FOLDER_JOB_TYPE,
        // No user: the job's end is not the user's business, the folder is already gone.
        repositoryId,
        payload: { name } satisfies DeleteFolderJobPayload
      });
    } catch {
      this.logger.warn(
        `Could not queue the removal of a deleted folder of repository ${repositoryId}; tmp/ is emptied on the next start`
      );
    }
  }
}
