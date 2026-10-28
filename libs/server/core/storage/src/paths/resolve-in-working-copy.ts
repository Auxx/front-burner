import type { Stats } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';

export type EntryType = 'file' | 'folder' | 'symlink' | 'other' | 'missing';

export interface ResolvedPath {
  /** The client path as given; `''` is the root. */
  relative: string;
  absolute: string;
  type: EntryType;
}

export type PathRefusal = 'malformed' | 'inside-git' | 'symlink' | 'not-found';

export class PathRefusedError extends Error {
  constructor(readonly reason: PathRefusal) {
    super(`Path refused: ${reason}`);
    this.name = 'PathRefusedError';
  }
}

export interface ResolveOptions {
  /** The last segment may not exist yet: it is reported as `missing` instead of refused. */
  mayBeMissing?: boolean;
  /** The last segment may be a symbolic link: it is reported as `symlink` instead of refused. */
  symlinkLeaf?: boolean;
}

const typeOf = (stats: Stats): EntryType =>
  stats.isSymbolicLink() ? 'symlink' : stats.isDirectory() ? 'folder' : stats.isFile() ? 'file' : 'other';

/** The entry's stats without following a link, or `undefined` when it is missing. */
async function lstatOrMissing(path: string): Promise<Stats | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

/**
 * Turns a client path into a file system path inside a working copy (A-7.6, FB-5).
 * The only way a files endpoint may build one. Never follows a symbolic link, in any segment,
 * and does not normalise: a path names an entry as it is on disk.
 *
 * @throws PathRefusedError
 */
export async function resolveInWorkingCopy(
  root: string,
  path: string,
  options: ResolveOptions = {}
): Promise<ResolvedPath> {
  if (path === '') {
    return { relative: '', absolute: root, type: 'folder' };
  }
  const segments = path.split('/');
  if (path.includes('\0') || segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new PathRefusedError('malformed');
  }
  if (segments.some(segment => segment.toLowerCase() === '.git')) {
    throw new PathRefusedError('inside-git');
  }
  let absolute = root;
  for (const [ index, segment ] of segments.entries()) {
    absolute = join(absolute, segment);
    const stats = await lstatOrMissing(absolute);
    const last = index === segments.length - 1;
    if (stats === undefined) {
      if (last && options.mayBeMissing) {
        return { relative: path, absolute, type: 'missing' };
      }
      throw new PathRefusedError('not-found');
    }
    if (stats.isSymbolicLink() && !(last && options.symlinkLeaf)) {
      throw new PathRefusedError('symlink');
    }
    if (last) {
      return { relative: path, absolute, type: typeOf(stats) };
    }
    if (!stats.isDirectory()) {
      throw new PathRefusedError('not-found');
    }
  }
  throw new PathRefusedError('malformed');
}
