import { GitEngine } from '@front-burner/server-core-git';
import { openInWorkingCopy, PathRefusedError, resolveInWorkingCopy } from '@front-burner/server-core-storage';
import type { Entry, EntryKind, FolderListing } from '@front-burner/shared-contracts';
import { compareEntryNames, isMarkdownName } from '@front-burner/shared-util';
import { Injectable } from '@nestjs/common';
import type { Dirent } from 'node:fs';
import { constants } from 'node:fs';
import { lstat, open, opendir, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** FB-18. */
export const MAX_LISTED_ENTRIES = 5000;

/** Never listed, in any case (FB-5, FB-19). */
const isGit = (name: string) => name.toLowerCase() === '.git';

/** Entries described at once: each may hold two descriptors, and the process has a limit (often 1,024). */
const DESCRIBE_CONCURRENCY = 64;

const SUBFOLDER_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;

interface Listed {
  name: string;
  kind: EntryKind;
}

const kindOf = (dirent: Dirent, gitlinks: Set<string>): EntryKind => {
  if (dirent.isSymbolicLink()) {
    return 'symlink';
  }
  if (dirent.isDirectory()) {
    return gitlinks.has(dirent.name) ? 'submodule' : 'folder';
  }
  // Anything else git could not have put there (a FIFO, a socket) is shown as a
  // file; reading one is refused by `openInWorkingCopy`.
  return 'file';
};

/** `items.map(fn)`, with at most `limit` calls running at once; keeps the order. */
async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const byGroupAndName = (a: Listed, b: Listed) =>
  Number(b.kind === 'folder') - Number(a.kind === 'folder') || compareEntryNames(a.name, b.name);

/**
 * True when the sub-folder has nothing listable in it. Opened through the
 * parent's descriptor without following a link, and read for at most two entries.
 */
async function isEmptyFolder(path: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(path, SUBFOLDER_FLAGS);
  } catch {
    // Gone or swapped for a link since `readdir`; the next listing shows it as it is.
    return false;
  }
  try {
    const dir = await opendir(`/proc/self/fd/${handle.fd}`);
    try {
      for (let read = 0; read < 2; read++) {
        const entry = await dir.read();
        if (entry === null) {
          return true;
        }
        if (!isGit(entry.name)) {
          return false;
        }
      }
      return (await dir.read()) === null;
    } finally {
      await dir.close();
    }
  } finally {
    await handle.close();
  }
}

/**
 * Lists one folder of a working copy (FB-15 to FB-20b). Reads only that
 * folder; its git queries are scoped to it too, so the cost does not grow with
 * the size of the working copy (NF-2.10). Takes no lock (A-5.3).
 */
@Injectable()
export class FolderLister {
  constructor(private readonly git: GitEngine) {}

  /** @throws PathRefusedError — `not-found` for a path that is not a folder. */
  async list(root: string, path: string): Promise<FolderListing> {
    const resolved = await resolveInWorkingCopy(root, path);
    if (resolved.type !== 'folder') {
      throw new PathRefusedError('not-found');
    }
    const folder = await openInWorkingCopy(root, resolved);
    try {
      const slash = path.lastIndexOf('/');
      const [ parent, name ] = slash === -1 ? [ '', path ] : [ path.slice(0, slash), path.slice(slash + 1) ];
      const [ dirents, gitlinks, folderIgnored, isSubmodule ] = await Promise.all([
        readdir(folder.path, { withFileTypes: true }),
        this.git.gitlinksIn(root, path),
        path !== '' && this.git.ignoredAmong(root, [ path ]).then(ignored => ignored.has(path)),
        path !== '' && this.git.gitlinksIn(root, parent).then(names => names.has(name))
      ]);
      // A submodule is not a folder of this repository, and cannot be expanded (FB-23).
      if (isSubmodule) {
        throw new PathRefusedError('not-found');
      }
      const all = dirents
        .filter(dirent => !isGit(dirent.name))
        .map(dirent => ({ name: dirent.name, kind: kindOf(dirent, gitlinks) }))
        .sort(byGroupAndName);
      const listed = all.slice(0, MAX_LISTED_ENTRIES);
      const [ ignored, entries ] = await Promise.all([
        // Inside an ignored folder everything is ignored (FB-20b), and git refuses to list it.
        folderIgnored ? new Set(listed.map(entry => entry.name)) : this.git.ignoredIn(root, path),
        mapLimited(listed, DESCRIBE_CONCURRENCY, entry => this.describe(folder.path, entry))
      ]);
      return {
        path,
        ignored: folderIgnored,
        entries: entries.map(entry => ({ ...entry, ignored: ignored.has(entry.name) })),
        more: all.length - listed.length
      };
    } finally {
      await folder.handle.close();
    }
  }

  private async describe(folder: string, { name, kind }: Listed): Promise<Entry> {
    const path = join(folder, name);
    const entry: Entry = { name, kind, size: null, markdown: false, ignored: false, empty: false };
    if (kind === 'file') {
      // Gone since `readdir`: listed with no size rather than failing the listing.
      entry.size = await lstat(path).then(stats => stats.size, () => null);
      entry.markdown = isMarkdownName(name);
    } else if (kind === 'folder') {
      entry.empty = await isEmptyFolder(path);
    }
    return entry;
  }
}
