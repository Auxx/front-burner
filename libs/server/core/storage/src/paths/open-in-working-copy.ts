import { constants } from 'node:fs';
import { FileHandle, lstat, open, realpath } from 'node:fs/promises';
import { sep } from 'node:path';
import { PathRefusedError, ResolvedPath } from './resolve-in-working-copy';

export interface OpenedEntry {
  /** The caller closes it. */
  handle: FileHandle;
  /** `/proc/self/fd/<fd>`: names the opened entry itself, for APIs that take a path (`readdir`). */
  path: string;
}

/** O_NONBLOCK: an entry swapped for a FIFO must not block the open; it has no effect on files and folders. */
const FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

const isInside = (path: string, root: string) => path === root || path.startsWith(root + sep);

/**
 * Opens a resolved file or folder for reading without following a symbolic
 * link, and checks that the descriptor's real path is still inside the
 * working copy (A-7.6). Listing and reading run outside the working-tree lock,
 * so a merge may have swapped an entry for a link since `resolveInWorkingCopy`;
 * read through the descriptor from here on, never through the path again.
 *
 * @throws PathRefusedError
 */
export async function openInWorkingCopy(root: string, entry: ResolvedPath): Promise<OpenedEntry> {
  if (entry.type !== 'file' && entry.type !== 'folder') {
    throw new PathRefusedError(entry.type === 'symlink' ? 'symlink' : 'not-found');
  }
  const folder = entry.type === 'folder';
  let handle: FileHandle;
  try {
    handle = await open(entry.absolute, FLAGS | (folder ? constants.O_DIRECTORY : 0));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ELOOP') {
      throw new PathRefusedError('symlink');
    }
    if (code === 'ENOTDIR') {
      // With O_DIRECTORY, Linux answers a link this way too; the stat only picks the reason.
      const link = await lstat(entry.absolute).then(stats => stats.isSymbolicLink(), () => false);
      throw new PathRefusedError(link ? 'symlink' : 'not-found');
    }
    if (code === 'ENOENT') {
      throw new PathRefusedError('not-found');
    }
    throw error;
  }
  try {
    const path = `/proc/self/fd/${handle.fd}`;
    const [ real, realRoot, stats ] = await Promise.all([ realpath(path), realpath(root), handle.stat() ]);
    if (!isInside(real, realRoot)) {
      // A folder on the way was swapped for a link: O_NOFOLLOW covers only the last segment.
      throw new PathRefusedError('symlink');
    }
    if (folder ? !stats.isDirectory() : !stats.isFile()) {
      throw new PathRefusedError('not-found');
    }
    return { handle, path };
  } catch (error) {
    await handle.close();
    throw error;
  }
}
