import type { GitEngine } from '@front-burner/server-core-git';
import {
  OpenedEntry,
  openInWorkingCopy,
  PathRefusedError,
  ResolvedPath,
  resolveInWorkingCopy
} from '@front-burner/server-core-storage';

export interface ExistingEntry {
  entry: ResolvedPath;
  /** The entry is a submodule itself (FB-23). */
  submodule: boolean;
}

/**
 * An existing entry of the working copy, a symbolic link included, for the
 * actions and summaries of one entry. What is inside a submodule is not part
 * of this repository, so it is refused as missing (FB-23).
 *
 * @throws PathRefusedError
 */
export async function resolveEntry(git: GitEngine, root: string, path: string): Promise<ExistingEntry> {
  const entry = await resolveInWorkingCopy(root, path, { symlinkLeaf: true });
  const submodule = await git.submoduleOn(root, path);
  if (submodule !== null && submodule !== path) {
    throw new PathRefusedError('not-found');
  }
  return { entry, submodule: submodule !== null };
}

/**
 * Opens a folder of the working copy to change its entries through the
 * descriptor, so that a folder on the way swapped for a link after the check
 * cannot redirect the change (A-7.6). A submodule, and anything inside one,
 * is not a folder of this repository (FB-23).
 *
 * @throws PathRefusedError
 */
export async function openFolder(git: GitEngine, root: string, path: string): Promise<OpenedEntry> {
  const resolved = await resolveInWorkingCopy(root, path);
  if (resolved.type !== 'folder') {
    throw new PathRefusedError('not-found');
  }
  if ((await git.submoduleOn(root, path)) !== null) {
    throw new PathRefusedError('not-found');
  }
  return openInWorkingCopy(root, resolved);
}
