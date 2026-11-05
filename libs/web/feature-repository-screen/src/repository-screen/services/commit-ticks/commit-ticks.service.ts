import { computed, effect, inject, Injectable, linkedSignal, untracked } from '@angular/core';
import { CurrentUserService } from '@front-burner/web-core';

import { GitStatusStore } from '../git-status-store/git-status-store.service';

/**
 * Which entries of **Changes** are ticked on this device (GA-17, A-4.5c).
 * Provided by the page.
 *
 * It remembers the **unticked** paths, so that a file that becomes changed later
 * starts ticked without being recorded, under
 * `fb.<userId>.unticked.<repositoryId>`. A path that is no longer a change is
 * forgotten whenever the status changes, so that the file comes back ticked.
 * Storage that is missing or refuses access only loses the memory.
 */
@Injectable()
export class CommitTicksService {
  private readonly store = inject(GitStatusStore);
  private readonly user = inject(CurrentUserService).user;

  private readonly key = computed(() => {
    const userId = this.user()?.id;
    const repositoryId = this.store.followed();
    return userId === undefined || repositoryId === null ? null : `fb.${userId}.unticked.${repositoryId}`;
  });

  private readonly unticked = linkedSignal<string | null, ReadonlySet<string>>({
    source: this.key,
    computation: key => new Set(key === null ? [] : readPaths(key))
  });

  private readonly paths = computed(() => this.store.status()?.changes.map(change => change.path) ?? []);

  /** The paths of the listed changes that are ticked, in the order of the list. */
  readonly ticked = computed(() => {
    const unticked = this.unticked();
    return this.paths().filter(path => !unticked.has(path));
  });

  /** What the checkbox at the top of the list shows. */
  readonly allState = computed<'all' | 'some' | 'none'>(() => {
    const ticked = this.ticked().length;
    if (ticked === 0) {
      return 'none';
    }
    return ticked === this.paths().length ? 'all' : 'some';
  });

  constructor() {
    effect(() => {
      const changes = this.store.status()?.changes;
      if (changes === undefined) {
        // Not read yet, which says nothing about what is still a change.
        return;
      }
      untracked(() => {
        const listed = new Set(changes.map(change => change.path));
        const kept = [ ...this.unticked() ].filter(path => listed.has(path));
        if (kept.length < this.unticked().size) {
          this.remember(kept);
        }
      });
    });
  }

  isTicked(path: string): boolean {
    return !this.unticked().has(path);
  }

  setTicked(path: string, ticked: boolean): void {
    const unticked = new Set(this.unticked());
    if (ticked) {
      unticked.delete(path);
    } else {
      unticked.add(path);
    }
    this.remember([ ...unticked ]);
  }

  /** Ticks or clears every listed change. */
  setAll(ticked: boolean): void {
    this.remember(ticked ? [] : this.paths());
  }

  private remember(paths: readonly string[]): void {
    this.unticked.set(new Set(paths));
    const key = this.key();
    if (key !== null) {
      writePaths(key, paths);
    }
  }
}

function readPaths(key: string): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(stored) && stored.every(path => typeof path === 'string') ? stored as string[] : [];
  } catch {
    return [];
  }
}

function writePaths(key: string, paths: readonly string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(paths));
  } catch {
    // Only the memory is lost.
  }
}
