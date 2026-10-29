import { inject, Injectable } from '@angular/core';
import { CurrentUserService } from '@front-burner/web-core';

import { isWithin, movedPath } from '../../utils/file-name/file-name';
import { FileTreeStoreService } from '../file-tree-store/file-tree-store.service';

/** A Markdown file named `README`, with any Markdown extension, ignoring case (FB-12). */
const README = /^readme\.(md|markdown|mdx)$/i;

/**
 * Which file the repository screen opens when the route names none (FB-12),
 * and the last file opened on this device, under
 * `fb.<userId>.repo.<repositoryId>.lastFile`. Storage that is missing or
 * refuses access only loses the memory.
 */
@Injectable()
export class FirstFileService {
  private readonly store = inject(FileTreeStoreService);
  private readonly currentUser = inject(CurrentUserService);
  /** Whether the next pick gives no file, after the open file was deleted (FB-39). */
  private closed = false;

  /**
   * The last file opened in the repository on this device, if it still exists
   * and is a Markdown file; else the root folder's README; else `null`.
   * `failed` when a folder it needs cannot be listed, so that the choice is
   * not made on what could not be seen. Right after the open file was
   * deleted, `null` (`deleted`).
   */
  async pick(repositoryId: number): Promise<string | null | 'failed'> {
    if (this.closed) {
      this.closed = false;
      return null;
    }
    const user = await this.currentUser.load();
    const last = read(key(user.id, repositoryId));
    if (last) {
      const found = await this.store.resolve(last);
      if (found === 'failed') {
        return 'failed';
      }
      if (found?.kind === 'file' && found.markdown) {
        return last;
      }
    }
    const entries = await this.store.entries('');
    if (entries === null) {
      return 'failed';
    }
    return entries.find(item => item.kind === 'file' && item.markdown && README.test(item.name))?.name ?? null;
  }

  /** Remembers `path` as the last file opened in the repository on this device. */
  remember(repositoryId: number, path: string): void {
    this.currentUser
      .load()
      .then(user => write(key(user.id, repositoryId), path))
      .catch(() => undefined);
  }

  /**
   * Follows a rename of the entry at `from` to `to` (FB-36): the last file
   * remembered, when it is that entry or lies under it, is remembered at its
   * new path.
   */
  renamed(repositoryId: number, from: string, to: string): void {
    this.currentUser
      .load()
      .then(user => {
        const storageKey = key(user.id, repositoryId);
        const last = read(storageKey);
        const moved = last === null ? null : movedPath(last, from, to);
        if (moved !== null) {
          write(storageKey, moved);
        }
      })
      .catch(() => undefined);
  }

  /**
   * Follows a delete of the entry at `path` (FB-39): the last file
   * remembered, when it is that entry or lies under it, is forgotten. When
   * the open file was deleted (`closed`), the next pick gives no file, so that
   * the screen shows the empty state and not the README.
   */
  async deleted(repositoryId: number, path: string, closed: boolean): Promise<void> {
    this.closed = closed;
    try {
      const user = await this.currentUser.load();
      const storageKey = key(user.id, repositoryId);
      const last = read(storageKey);
      if (last !== null && isWithin(last, path)) {
        remove(storageKey);
      }
    } catch {
      // Only the memory is kept.
    }
  }
}

function key(userId: number, repositoryId: number): string {
  return `fb.${userId}.repo.${repositoryId}.lastFile`;
}

function read(storageKey: string): string | null {
  try {
    return localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

function write(storageKey: string, value: string): void {
  try {
    localStorage.setItem(storageKey, value);
  } catch {
    // Only the memory is lost.
  }
}

function remove(storageKey: string): void {
  try {
    localStorage.removeItem(storageKey);
  } catch {
    // The memory stays; the file is gone, so it is not opened.
  }
}
