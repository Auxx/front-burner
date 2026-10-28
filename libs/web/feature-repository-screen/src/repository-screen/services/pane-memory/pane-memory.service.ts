import { effect, inject, Injectable, signal, untracked } from '@angular/core';
import { CurrentUserService } from '@front-burner/web-core';

const DEFAULT_SIDE_SIZE = 20;

/**
 * The repository screen's panes as this device last left them (FB-8): the file
 * tree's share of the width and whether it is collapsed, under
 * `fb.<userId>.repositoryScreen.<key>`. Read once the user is known, then
 * written back on every change. Storage that is missing or refuses access
 * only loses the memory.
 */
@Injectable()
export class PaneMemoryService {
  /** The file tree's share of the width, in percent. */
  readonly sideSize = signal(DEFAULT_SIDE_SIZE);
  /** Whether the file tree is beside the editor on wide screens. */
  readonly sideOpen = signal(true);

  constructor() {
    const user = inject(CurrentUserService).user;
    let userId: number | undefined;

    effect(() => {
      const id = user()?.id;
      if (id === undefined || id === userId) {
        return;
      }
      userId = id;
      untracked(() => {
        const size = Number(read(id, 'sideSize') ?? Number.NaN);
        if (Number.isFinite(size) && size > 0 && size < 100) {
          this.sideSize.set(size);
        }
        const open = read(id, 'sideOpen');
        if (open === 'true' || open === 'false') {
          this.sideOpen.set(open === 'true');
        }
      });
    });

    effect(() => {
      const size = this.sideSize();
      const open = this.sideOpen();
      if (userId !== undefined) {
        write(userId, 'sideSize', String(size));
        write(userId, 'sideOpen', String(open));
      }
    });
  }
}

type Key = 'sideSize' | 'sideOpen';

function read(userId: number, key: Key): string | null {
  try {
    return localStorage.getItem(`fb.${userId}.repositoryScreen.${key}`);
  } catch {
    return null;
  }
}

function write(userId: number, key: Key, value: string): void {
  try {
    localStorage.setItem(`fb.${userId}.repositoryScreen.${key}`, value);
  } catch {
    // Only the memory is lost.
  }
}
