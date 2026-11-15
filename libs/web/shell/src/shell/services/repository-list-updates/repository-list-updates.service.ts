import { DestroyRef, inject, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { PushEvent, RepositorySummary } from '@front-burner/shared-contracts';
import { PushChannelService } from '@front-burner/web-core';

/** A page's list of repositories, as `RepositoryListUpdatesService.follow` sees it. */
export interface FollowedRepositoryList {
  /** The list on screen, or `null` while it has not loaded. */
  readonly repositories: () => readonly RepositorySummary[] | null;
  /** Shows the list with a repository's new status. */
  readonly update: (repositories: readonly RepositorySummary[]) => void;
  /** Fetches the list again; a reload that fails should leave the list on screen. */
  readonly reload: () => void;
}

/**
 * Keeps a list of repositories current while a page shows it, so that it
 * follows clones without a reload (DS-23, RM-7). Events are notifications only
 * (A-3.11): a status for a listed repository is patched in place, and anything
 * the list cannot apply asks for the list again.
 */
@Injectable({ providedIn: 'root' })
export class RepositoryListUpdatesService {
  private readonly push = inject(PushChannelService);

  /**
   * Follows `list` until `destroyRef` is destroyed; by default, that of the
   * component whose constructor calls it.
   */
  follow(list: FollowedRepositoryList, destroyRef: DestroyRef = inject(DestroyRef)): void {
    this.push.events.pipe(takeUntilDestroyed(destroyRef)).subscribe(event => this.onEvent(list, event));
    this.push.reconnected.pipe(takeUntilDestroyed(destroyRef)).subscribe(() => list.reload());
  }

  private onEvent(list: FollowedRepositoryList, event: PushEvent): void {
    if (event.type !== 'repository.status') {
      return;
    }
    const repositories = list.repositories();
    // While loading, the answer on its way may predate the event; a repository
    // not listed may be a new one, added in another tab.
    if (repositories === null || !repositories.some(repository => repository.id === event.repositoryId)) {
      list.reload();
      return;
    }
    list.update(
      repositories.map(repository =>
        repository.id === event.repositoryId ? { ...repository, status: event.status, error: event.error } : repository
      )
    );
  }
}
