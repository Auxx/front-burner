import { EventsHub } from '@front-burner/server-core-events';
import { GitEngine } from '@front-burner/server-core-git';
import { DATA_LAYOUT, DataLayout, openInWorkingCopy, PathRefusedError } from '@front-burner/server-core-storage';
import { EDITABLE_FILE_LIMIT } from '@front-burner/shared-contracts';
import type { FileContent, FileState, SaveFileRequest } from '@front-burner/shared-contracts';
import { isMarkdownName } from '@front-burner/shared-util';
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import { link, lstat, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { WorkingTreeGuard } from '../actions/working-tree-guard';
import { entryExists, entryNotEditable, fileNotUtf8, fileTooLarge, toFilesError } from '../files/files-errors';
import { splitPath } from '../paths/entry-paths';
import { openFolder, resolveEntry } from '../paths/existing-entry';
import { OpenableRepository } from '../repository/openable-repository';
import { decodeMarkdown, encodeMarkdown, hashBytes } from './markdown-codec';

/** `[ parent, name ]` of a Markdown file's path; anything else is refused (ED-2, FB-21). */
function markdownPath(path: string): [ string, string ] {
  const [ parent, name ] = splitPath(path);
  if (path === '' || !isMarkdownName(name)) {
    throw entryNotEditable();
  }
  return [ parent, name ];
}

/** The entry's stats without following a link, or `undefined` when it is missing. */
const lstatOrMissing = (path: string): Promise<Stats | undefined> =>
  lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  });

/**
 * Reads and saves the Markdown files the editor edits (ED-2, ED-6, ED-12,
 * ED-19, ED-21). Saves change only the working tree: nothing is staged or
 * committed (D-1.2).
 */
@Injectable()
export class FileContents {
  constructor(
    private readonly repositories: OpenableRepository,
    private readonly guard: WorkingTreeGuard,
    private readonly git: GitEngine,
    private readonly events: EventsHub,
    @Inject(DATA_LAYOUT) private readonly layout: DataLayout
  ) {}

  /**
   * A Markdown file opened for editing (ED-2, ED-6, FB-21). Takes no lock, so
   * it reads through a descriptor opened without following a link (A-7.6).
   *
   * @throws PathRefusedError
   * @throws ApiErrorException
   */
  async read(root: string, path: string): Promise<FileContent> {
    const bytes = await this.readBytes(root, path);
    const text = decodeMarkdown(bytes);
    if (text === 'not-utf8') {
      throw fileNotUtf8();
    }
    return { path, ...text, hash: hashBytes(bytes), size: bytes.length };
  }

  /**
   * The hash and size of a Markdown file as it is on disk now, to tell whether
   * it changed (ED-24).
   *
   * @throws PathRefusedError
   * @throws ApiErrorException
   */
  async state(root: string, path: string): Promise<FileState> {
    const bytes = await this.readBytes(root, path);
    return { hash: hashBytes(bytes), size: bytes.length };
  }

  /** Saves an existing Markdown file; never creates one (ED-12, ED-19, ED-21). */
  async save(userId: number, repositoryId: number, request: SaveFileRequest): Promise<FileState> {
    const root = this.repositories.root(userId, repositoryId);
    const [ parent, name ] = markdownPath(request.path);
    const bytes = this.encode(request);
    await this.guard.change(repositoryId, root, async () => {
      const folder = await openFolder(this.git, root, parent);
      try {
        const target = join(folder.path, name);
        const stats = await lstatOrMissing(target);
        if (stats === undefined) {
          throw new PathRefusedError('not-found');
        }
        if (stats.isSymbolicLink()) {
          throw new PathRefusedError('symlink');
        }
        if (!stats.isFile()) {
          throw entryNotEditable();
        }
        const temporary = await this.writeTemporary(bytes, stats.mode & 0o7777);
        // One rename: the file holds either the old content or the new, never part of it.
        await rename(temporary, target).catch(async (error: unknown) => {
          await rm(temporary, { force: true });
          throw error;
        });
      } finally {
        await folder.handle.close();
      }
    }).catch(toFilesError);
    return this.saved(userId, repositoryId, request.path, parent, bytes);
  }

  /** **Recreate it**: creates a file deleted or renamed elsewhere with the editor's content (ED-21). */
  async recreate(userId: number, repositoryId: number, request: SaveFileRequest): Promise<FileState> {
    const root = this.repositories.root(userId, repositoryId);
    const [ parent, name ] = markdownPath(request.path);
    const bytes = this.encode(request);
    await this.guard.change(repositoryId, root, async () => {
      const folder = await openFolder(this.git, root, parent);
      try {
        const temporary = await this.writeTemporary(bytes, 0o644);
        try {
          // A hard link is exclusive: an entry created meanwhile is never overwritten.
          await link(temporary, join(folder.path, name));
        } catch (error) {
          throw (error as NodeJS.ErrnoException).code === 'EEXIST' ? entryExists() : error;
        } finally {
          await rm(temporary, { force: true });
        }
      } finally {
        await folder.handle.close();
      }
    }).catch(toFilesError);
    return this.saved(userId, repositoryId, request.path, parent, bytes);
  }

  /** The bytes of a Markdown file, refused when they are over the limit (ED-2). */
  private async readBytes(root: string, path: string): Promise<Buffer> {
    markdownPath(path);
    const { entry, submodule } = await resolveEntry(this.git, root, path);
    if (entry.type === 'symlink') {
      throw new PathRefusedError('symlink');
    }
    if (submodule || entry.type !== 'file') {
      throw entryNotEditable();
    }
    const opened = await openInWorkingCopy(root, entry);
    try {
      if ((await opened.handle.stat()).size > EDITABLE_FILE_LIMIT) {
        throw fileTooLarge(EDITABLE_FILE_LIMIT);
      }
      const bytes = await opened.handle.readFile();
      // It may have grown since the stat.
      if (bytes.length > EDITABLE_FILE_LIMIT) {
        throw fileTooLarge(EDITABLE_FILE_LIMIT);
      }
      return bytes;
    } finally {
      await opened.handle.close();
    }
  }

  /** The bytes to store, refused when they are over the limit as stored, line endings and BOM included (ED-19). */
  private encode(request: SaveFileRequest): Buffer {
    const bytes = encodeMarkdown(request);
    if (bytes.length > EDITABLE_FILE_LIMIT) {
      throw fileTooLarge(EDITABLE_FILE_LIMIT);
    }
    return bytes;
  }

  /**
   * Writes `bytes` to a new file in `tmp/`, named without anything from the
   * user's path (A-6.3), and flushes it to disk, so that the rename or link
   * that follows never exposes an empty file after a crash (NF-5.3).
   */
  private async writeTemporary(bytes: Buffer, mode: number): Promise<string> {
    const path = join(this.layout.tmpDir, `save-${randomUUID()}`);
    const handle = await open(path, 'wx', mode);
    try {
      await handle.writeFile(bytes);
      // The umask may have dropped bits of the old file's mode.
      await handle.chmod(mode);
      await handle.sync();
    } catch (error) {
      await handle.close();
      await rm(path, { force: true });
      throw error;
    }
    await handle.close();
    return path;
  }

  /** Tells the user's clients the new hash, so that each can tell its own saves from changes elsewhere (A-3.11). */
  private saved(userId: number, repositoryId: number, path: string, parent: string, bytes: Buffer): FileState {
    const hash = hashBytes(bytes);
    this.events.publish(userId, {
      type: 'files.changed',
      repositoryId,
      folders: [ parent ],
      files: [ { path, hash } ]
    });
    return { hash, size: bytes.length };
  }
}
