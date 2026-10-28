import { GitEngine } from '@front-burner/server-core-git';
import {
  openInWorkingCopy,
  PathRefusedError,
  ResolvedPath,
  resolveInWorkingCopy
} from '@front-burner/server-core-storage';
import type { EntrySummary, NewEntryKind } from '@front-burner/shared-contracts';
import { isMarkdownName } from '@front-burner/shared-util';
import { Injectable } from '@nestjs/common';
import { open, opendir } from 'node:fs/promises';
import { join } from 'node:path';
import { isGitName, splitPath, SUBFOLDER_FLAGS } from '../paths/entry-paths';
import { resolveEntry } from '../paths/existing-entry';

interface Counts {
  files: number;
  nonMarkdown: number;
}

/**
 * Counts the files of a folder's subtree into `counts`, reading through
 * descriptors and never following a symbolic link. A symbolic link counts as
 * a non-Markdown file. A folder that holds a `.git` (a submodule or another
 * repository) counts as nothing.
 */
async function walk(folder: string, counts: Counts, top: boolean): Promise<void> {
  const names: string[] = [];
  const subfolders: string[] = [];
  let nonMarkdown = 0;
  let nested = false;
  for await (const entry of await opendir(folder)) {
    if (isGitName(entry.name)) {
      nested = true;
    } else if (entry.isDirectory()) {
      subfolders.push(entry.name);
    } else {
      names.push(entry.name);
      if (!entry.isFile() || !isMarkdownName(entry.name)) {
        nonMarkdown++;
      }
    }
  }
  if (nested && !top) {
    return;
  }
  counts.files += names.length;
  counts.nonMarkdown += nonMarkdown;
  for (const name of subfolders) {
    let handle;
    try {
      handle = await open(join(folder, name), SUBFOLDER_FLAGS);
    } catch {
      // Gone or swapped for a link since it was read: not counted.
      continue;
    }
    try {
      await walk(`/proc/self/fd/${handle.fd}`, counts, false);
    } finally {
      await handle.close();
    }
  }
}

/**
 * What an entry holds, for the rename and delete confirmations (FB-35, FB-38),
 * and whether a new entry would be ignored (FB-31, FB-34). Takes no lock (A-5.3).
 */
@Injectable()
export class EntrySummaries {
  constructor(private readonly git: GitEngine) {}

  /** @throws PathRefusedError */
  async summary(root: string, path: string): Promise<EntrySummary> {
    const { entry, submodule } = await resolveEntry(this.git, root, path);
    if (submodule) {
      // A submodule counts as nothing (FB-23).
      return { files: 0, nonMarkdown: 0, uncommitted: 0 };
    }
    if (entry.type !== 'folder') {
      const markdown = entry.type === 'file' && isMarkdownName(splitPath(path)[1]);
      const uncommitted = await this.git.uncommittedUnder(root, path);
      return { files: 1, nonMarkdown: markdown ? 0 : 1, uncommitted: Math.min(uncommitted, 1) };
    }
    const [ counts, uncommitted ] = await Promise.all([
      this.count(root, entry),
      this.git.uncommittedUnder(root, path)
    ]);
    return { ...counts, uncommitted };
  }

  /**
   * True when `.gitignore` rules ignore a new entry at `path` (FB-31, FB-34).
   * The entry need not exist, its folder must.
   *
   * @throws PathRefusedError
   */
  async ignored(root: string, path: string, kind: NewEntryKind): Promise<boolean> {
    if (path === '') {
      throw new PathRefusedError('malformed');
    }
    await resolveInWorkingCopy(root, path, { mayBeMissing: true, symlinkLeaf: true });
    if ((await this.git.submoduleOn(root, path)) !== null) {
      throw new PathRefusedError('not-found');
    }
    // A trailing `/` makes folder rules such as `build/` match a folder that does not exist yet.
    const asked = kind === 'folder' ? `${path}/` : path;
    return (await this.git.ignoredAmong(root, [ asked ])).has(asked);
  }

  private async count(root: string, entry: ResolvedPath): Promise<Counts> {
    const folder = await openInWorkingCopy(root, entry);
    const counts = { files: 0, nonMarkdown: 0 };
    try {
      await walk(folder.path, counts, true);
    } finally {
      await folder.handle.close();
    }
    return counts;
  }
}
