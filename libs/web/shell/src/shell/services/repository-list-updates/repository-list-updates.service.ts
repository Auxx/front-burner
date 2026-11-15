import { DestroyRef, effect, inject, Injectable, Injector, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { PushEvent, RepositorySummary } from '@front-burner/shared-contracts';
import { PushChannelService } from '@front-burner/web-core';

/** A page's list of repositories, as `RepositoryListUpdatesService.follow` sees it. */
export interface FollowedRepositoryList {
  /**
   * The list on screen, or `null` while there is none: before the first
   * answer, or after a load failed. Read from signals, so that `follow` sees
   * it change.
   */
  readonly repositories: () => readonly RepositorySummary[] | null;
  /** Whether the latest request for the list is still running. Read from signals. */
  readonly loading: () => boolean;
  /** Shows the list with a repository's new status. */
  readonly update: (repositories: readonly RepositorySummary[]) => void;
  /** Fetches the list again; a reload that fails should leave the list on screen. */
  readonly reload: () => void;
}

/**
 * Keeps a list of repositories current while a page shows it, so that it
 * follows clones without a reload (DS-23, RM-7). Events are notifications only
 * (A-3.11): a status for a listed repository is patched in place, and anything
 * the list cannot apply (a repository not listed) asks for the list again, as
 * does a reconnect.
 *
 * At most one reload waits at a time: while a request for the list runs, the
 * statuses that need one are remembered, and a single reload follows once the
 * request has ended, as its answer may predate them. While the list failed to
 * load, a status asks for nothing: the page shows **Try again**, and its
 * answer will be newer than the event.
 */
@Injectable({ providedIn: 'root' })
export class RepositoryListUpdatesService {
  private readonly push = inject(PushChannelService);

  /**
   * Follows `list` until the component that calls it is destroyed. Call it in
   * an injection context, such as the component's constructor.
   */
  follow(list: FollowedRepositoryList): void {
    const destroyRef = inject(DestroyRef);
    const injector = inject(Injector);
    let reloadAfterLoad = false;

    const askForReload = (): void => {
      if (list.loading()) {
        reloadAfterLoad = true;
      } else {
        list.reload();
      }
    };

    effect(() => {
      if (list.loading() || !reloadAfterLoad) {
        return;
      }
      reloadAfterLoad = false;
      // A load that failed and left nothing on screen shows Try again instead.
      untracked(() => list.repositories() !== null && list.reload());
    }, { injector });

    this.push.events.pipe(takeUntilDestroyed(destroyRef)).subscribe(event => this.onEvent(list, event, askForReload));
    // Events may have been missed while disconnected: fetch at once, even
    // during a load that may have started before the disconnect. The new
    // answer is newer than every event so far, so none still waits for one.
    this.push.reconnected.pipe(takeUntilDestroyed(destroyRef)).subscribe(() => {
      reloadAfterLoad = false;
      list.reload();
    });
  }

  private onEvent(list: FollowedRepositoryList, event: PushEvent, askForReload: () => void): void {
    if (event.type !== 'repository.status') {
      return;
    }
    const repositories = list.repositories();
    if (repositories === null) {
      // Only the first answer can still bring a list, and it may predate the event.
      if (list.loading()) {
        askForReload();
      }
      return;
    }
    if (!repositories.some(repository => repository.id === event.repositoryId)) {
      // A repository not listed may be a new one, added in another tab.
      askForReload();
      return;
    }
    list.update(
      repositories.map(repository =>
        repository.id === event.repositoryId ? { ...repository, status: event.status, error: event.error } : repository
      )
    );
    if (list.loading()) {
      // The answer on its way may predate the event and undo the patch.
      askForReload();
    }
  }
}
