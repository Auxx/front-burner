import { inject, Injectable } from '@angular/core';
import { CurrentUserService } from '@front-burner/web-core';

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

  /**
   * The last file opened in the repository on this device, if it still exists
   * and is a Markdown file; else the root folder's README; else `null`.
   */
  async pick(repositoryId: number): Promise<string | null> {
    const user = await this.currentUser.load();
    const last = read(key(user.id, repositoryId));
    if (last) {
      const found = await this.store.resolve(last);
      if (found?.kind === 'file' && found.markdown) {
        return last;
      }
    }
    const entries = await this.store.entries('');
    return entries?.find(item => item.kind === 'file' && item.markdown && README.test(item.name))?.name ?? null;
  }

  /** Remembers `path` as the last file opened in the repository on this device. */
  remember(repositoryId: number, path: string): void {
    this.currentUser
      .load()
      .then(user => write(key(user.id, repositoryId), path))
      .catch(() => undefined);
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
