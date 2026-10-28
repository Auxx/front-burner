import { EventsHub } from '@front-burner/server-core-events';
import { GitEngine } from '@front-burner/server-core-git';
import { JobRunner } from '@front-burner/server-core-jobs';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { DATA_LAYOUT, DataLayout, PathRefusedError, resolveInWorkingCopy } from '@front-burner/server-core-storage';
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { toFilesError } from '../files/files-errors';
import { splitPath } from '../paths/entry-paths';
import { OpenableRepository } from '../repository/openable-repository';
import { WorkingTreeGuard } from './working-tree-guard';

/** The **Delete folder** job of A-6 (FB-40). */
export const DELETE_FOLDER_JOB_TYPE = 'files.delete-folder';

export interface DeleteFolderJobPayload {
  /** The trashed folder's name in `tmp/`, `delete-<uuid>`; never derived from the user's path (A-6.3). */
  name: string;
}

const notDeletable = () => new ApiErrorException(400, 'entry-not-deletable', {}, 'This can\'t be deleted.');

/**
 * Deletes entries of a working copy (FB-37, FB-40). Changes only the working
 * tree: nothing is staged or committed (D-1.2).
 */
@Injectable()
export class EntryDelete {
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
      throw notDeletable();
    }
    const [ parent ] = splitPath(path);
    const folder = await this.guard.change(repositoryId, root, async () => {
      const entry = await resolveInWorkingCopy(root, path, { symlinkLeaf: true });
      const submodule = await this.git.submoduleOn(root, path);
      if (submodule !== null) {
        throw submodule === path ? notDeletable() : new PathRefusedError('not-found');
      }
      if (entry.type !== 'folder') {
        // unlink never follows a link: only the link itself goes (AC-FILE-001.11).
        await unlink(entry.absolute);
        return false;
      }
      const name = `delete-${randomUUID()}`;
      await rename(entry.absolute, join(this.layout.tmpDir, name));
      this.jobs.enqueue({
        type: DELETE_FOLDER_JOB_TYPE,
        // No user: the job's end is not the user's business, the folder is already gone.
        repositoryId,
        payload: { name } satisfies DeleteFolderJobPayload
      });
      return true;
    }).catch(toFilesError);
    // A deleted folder's path is named too, so that clients drop what they listed under it (FB-41).
    this.events.publish(userId, {
      type: 'files.changed',
      repositoryId,
      folders: [ parent, ...(folder ? [ path ] : []) ]
    });
  }
}
