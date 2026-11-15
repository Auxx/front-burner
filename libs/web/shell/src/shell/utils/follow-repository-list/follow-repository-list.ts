import { computed, inject, type Signal, signal } from '@angular/core';
import type { RepositorySummary } from '@front-burner/shared-contracts';
import { firstValueFrom, type Observable } from 'rxjs';

import { RepositoryListUpdatesService } from '../../services/repository-list-updates/repository-list-updates.service';

/** A page's list of repositories: loading, failed to load, or on screen. */
export type RepositoryListState =
  | { kind: 'loading'; }
  | { kind: 'failed'; }
  | { kind: 'loaded'; repositories: readonly RepositorySummary[]; };

/** What `followRepositoryList` gives a page. */
export interface FollowedList {
  readonly state: Signal<RepositoryListState>;
  /** The list on screen, or `null` while loading or after the load failed. */
  readonly repositories: Signal<readonly RepositorySummary[] | null>;
  /** Whether **Try again** is loading the list. */
  readonly retrying: Signal<boolean>;
  /** **Try again** after a failed load (DS-26). */
  retry(): Promise<void>;
}

export interface FollowRepositoryListOptions {
  /** Called with every list that the latest request answered. */
  readonly loaded?: (repositories: readonly RepositorySummary[]) => void;
}

/**
 * Loads a page's list of repositories at once and keeps it current with
 * `RepositoryListUpdatesService` until the page is destroyed, as the dashboard
 * and the repository management page do (DS-23, DS-25, DS-26, RM-7). Only the
 * answer to the latest request counts. A reload that fails leaves the list on
 * screen as it was; a first load or **Try again** that fails shows the failure.
 * Call it in an injection context, such as the page's constructor.
 */
export function followRepositoryList(
  fetch: () => Observable<{ repositories: readonly RepositorySummary[]; }>,
  options: FollowRepositoryListOptions = {}
): FollowedList {
  const state = signal<RepositoryListState>({ kind: 'loading' });
  const retrying = signal(false);
  /** Whether the latest request for the list is still running. */
  const loading = signal(false);
  /** The number of the latest request for the list. */
  let loads = 0;

  const repositories = computed(() => {
    const current = state();
    return current.kind === 'loaded' ? current.repositories : null;
  });

  async function load(keepOnFailure: boolean): Promise<void> {
    const request = ++loads;
    loading.set(true);
    let answer: readonly RepositorySummary[];
    try {
      ({ repositories: answer } = await firstValueFrom(fetch()));
    } catch {
      if (request === loads) {
        if (!(keepOnFailure && state().kind === 'loaded')) {
          state.set({ kind: 'failed' });
        }
        loading.set(false);
      }
      return;
    }
    if (request !== loads) {
      return;
    }
    state.set({ kind: 'loaded', repositories: answer });
    loading.set(false);
    options.loaded?.(answer);
  }

  inject(RepositoryListUpdatesService).follow({
    repositories,
    loading,
    update: updated => state.set({ kind: 'loaded', repositories: updated }),
    reload: () => void load(true)
  });
  void load(false);

  return {
    state: state.asReadonly(),
    repositories,
    retrying: retrying.asReadonly(),
    retry: async () => {
      retrying.set(true);
      try {
        await load(false);
      } finally {
        retrying.set(false);
      }
    }
  };
}
