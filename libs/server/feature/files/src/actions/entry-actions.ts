import { EventsHub } from '@front-burner/server-core-events';
import { GitEngine } from '@front-burner/server-core-git';
import { ApiErrorException } from '@front-burner/server-core-observability';
import type { CreateEntryRequest, EntryPath, RenameEntryRequest } from '@front-burner/shared-contracts';
import { entryNameProblem, isMarkdownName, sameEntryName, withMarkdownExtension } from '@front-burner/shared-util';
import { Injectable } from '@nestjs/common';
import { mkdir, open, readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { entryNotRenamable, toFilesError } from '../files/files-errors';
import { joinPath, splitPath } from '../paths/entry-paths';
import { openFolder, resolveEntry } from '../paths/existing-entry';
import { OpenableRepository } from '../repository/openable-repository';
import { WorkingTreeGuard } from './working-tree-guard';

/** A field error on the request's `name`, answered like Zod's (A-3.9). */
const nameError = (code: string, params: Record<string, unknown> = {}) =>
  ApiErrorException.forFields([ { path: 'name', code, params } ]);

const nameTaken = (name: string) => nameError('name-taken', { name });

/**
 * The name to store (FB-28, FB-29): NFC, and for a file always with a Markdown
 * extension. The schema checked the name as typed; the extension may make it too long.
 */
function finalName(name: string, kind: 'file' | 'folder'): string {
  const nfc = name.normalize('NFC');
  const final = kind === 'file' ? withMarkdownExtension(nfc) : nfc;
  const problem = entryNameProblem(final);
  if (problem !== null) {
    throw nameError(problem);
  }
  return final;
}

/**
 * Creates and renames entries of a working copy (FB-27 to FB-35). Changes
 * only the working tree: nothing is staged or committed (D-1.2).
 */
@Injectable()
export class EntryActions {
  constructor(
    private readonly repositories: OpenableRepository,
    private readonly guard: WorkingTreeGuard,
    private readonly git: GitEngine,
    private readonly events: EventsHub
  ) {}

  /** **New file** (an empty file, FB-30) or **New folder** (FB-32) inside `folder`. */
  async create(userId: number, repositoryId: number, request: CreateEntryRequest): Promise<EntryPath> {
    const root = this.repositories.root(userId, repositoryId);
    const name = finalName(request.name, request.kind);
    await this.guard.change(repositoryId, root, async () => {
      const folder = await openFolder(this.git, root, request.folder);
      try {
        await this.assertFree(folder.path, name);
        const path = join(folder.path, name);
        try {
          if (request.kind === 'file') {
            // Exclusive: a file created meanwhile is never overwritten (FB-30).
            await (await open(path, 'wx')).close();
          } else {
            await mkdir(path);
          }
        } catch (error) {
          throw (error as NodeJS.ErrnoException).code === 'EEXIST' ? nameTaken(name) : error;
        }
      } finally {
        await folder.handle.close();
      }
    }).catch(toFilesError);
    this.publish(userId, repositoryId, request.folder);
    return { path: joinPath(request.folder, name) };
  }

  /** **Rename** a Markdown file or a folder in place (FB-35). */
  async rename(userId: number, repositoryId: number, request: RenameEntryRequest): Promise<EntryPath> {
    const root = this.repositories.root(userId, repositoryId);
    if (request.path === '') {
      throw entryNotRenamable();
    }
    const [ parent, oldName ] = splitPath(request.path);
    let folder = false;
    const name = await this.guard.change(repositoryId, root, async () => {
      const { entry, submodule } = await resolveEntry(this.git, root, request.path);
      const renamable = entry.type === 'folder' ? !submodule : entry.type === 'file' && isMarkdownName(oldName);
      if (!renamable) {
        throw entryNotRenamable();
      }
      const name = finalName(request.name, entry.type === 'folder' ? 'folder' : 'file');
      folder = entry.type === 'folder';
      if (name === oldName) {
        return name;
      }
      const opened = await openFolder(this.git, root, parent);
      try {
        // Its own name in another case or form is not a clash (FB-27).
        await this.assertFree(opened.path, name, oldName);
        // The lock keeps other changes of this instance out between the check and the rename.
        await rename(join(opened.path, oldName), join(opened.path, name));
      } finally {
        await opened.handle.close();
      }
      return name;
    }).catch(toFilesError);
    if (name !== oldName) {
      this.publish(userId, repositoryId, parent, ...(folder ? [ request.path ] : []));
    }
    return { path: joinPath(parent, name) };
  }

  /** Refuses a name that clashes with another entry of the folder (FB-27). */
  private async assertFree(folder: string, name: string, except?: string): Promise<void> {
    const clash = (await readdir(folder)).some(entry => entry !== except && sameEntryName(entry, name));
    if (clash) {
      throw nameTaken(name);
    }
  }

  /** A renamed folder's old path is named too, so that clients drop what they listed under it (FB-41). */
  private publish(userId: number, repositoryId: number, ...folders: string[]): void {
    this.events.publish(userId, { type: 'files.changed', repositoryId, folders });
  }
}
