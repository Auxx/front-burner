import { DestroyRef, effect, inject, Injectable, Injector, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { PushEvent, RepositorySummary } from '@front-burner/shared-contracts';
import { PushChannelService, RemovedRepositoriesService } from '@front-burner/web-core';

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
 * (A-3.11): a status for a listed repository, and the progress of a listed
 * clone (`job.progress` of its `clone.jobId`), are patched in place, and anything
 * the list cannot apply (a repository not listed) asks for the list again, as
 * does a reconnect. A repository removed elsewhere is dropped from it (RM-20).
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
  private readonly removals = inject(RemovedRepositoriesService);

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
    // This device's drafts of a repository removed elsewhere are deleted while a list is shown too (RM-19).
    this.removals.watch();
    // Events may have been missed while disconnected: fetch at once, even
    // during a load that may have started before the disconnect. The new
    // answer is newer than every event so far, so none still waits for one.
    this.push.reconnected.pipe(takeUntilDestroyed(destroyRef)).subscribe(() => {
      reloadAfterLoad = false;
      list.reload();
    });
  }

  private onEvent(list: FollowedRepositoryList, event: PushEvent, askForReload: () => void): void {
    if (event.type === 'job.progress') {
      this.onProgress(list, event.jobId, event.percent);
      return;
    }
    if (event.type === 'repository.removed') {
      this.onRemoved(list, event.repositoryId, askForReload);
      return;
    }
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
        repository.id === event.repositoryId
          ? {
            ...repository,
            status: event.status,
            error: event.error,
            // A clone that ended is gone; a new one is known only from the list.
            clone: event.status === 'cloning' ? repository.clone : null
          }
          : repository
      )
    );
    // The answer on its way may predate the event and undo the patch, and a
    // clone queued again (RM-11, RM-12) has a job the list does not know yet.
    if (list.loading() || event.status === 'cloning') {
      askForReload();
    }
  }

  /**
   * A removed repository leaves the list at once (RM-20, RM-21). An answer on
   * its way may still list it, so the list is asked for again after it.
   */
  private onRemoved(list: FollowedRepositoryList, repositoryId: number, askForReload: () => void): void {
    const repositories = list.repositories();
    if (repositories?.some(repository => repository.id === repositoryId)) {
      list.update(repositories.filter(repository => repository.id !== repositoryId));
    }
    if (list.loading()) {
      askForReload();
    }
  }

  /**
   * A listed clone's progress, which also means that it runs (AR-52). Other
   * jobs' progress is not about the list. An answer on its way may show an
   * older percentage, so nothing is reloaded for it: the next report corrects it.
   */
  private onProgress(list: FollowedRepositoryList, jobId: number, percent: number): void {
    const repositories = list.repositories();
    if (repositories === null || !repositories.some(repository => repository.clone?.jobId === jobId)) {
      return;
    }
    list.update(
      repositories.map(repository =>
        repository.clone?.jobId === jobId
          ? { ...repository, clone: { jobId, state: 'running', percent } }
          : repository
      )
    );
  }
}
