import { DestroyRef, inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import type { Subscription } from 'rxjs';

import { DraftStore } from '../../saving/draft-store';
import { PushChannelService } from '../push-channel/push-channel.service';

/** A page that shows one repository, as `RemovedRepositoriesService.watch` sees it. */
export interface RemovedRepositoryViewer {
  /** The ID of the repository on screen, or `null` while none is. Read when a removal comes. */
  readonly repositoryId: () => number | null;
  /**
   * Called when that repository was removed elsewhere, before the tab goes to
   * the dashboard: the page drops what it would still send, and says so.
   */
  readonly removed: () => void;
}

/**
 * Follows the removal of a repository in another tab or on another device
 * (RM-19, RM-20). On `repository.removed`, every page that shows that
 * repository is told, the tab goes to the dashboard, and this device's
 * browser drafts of the repository are deleted. The lists drop it themselves
 * (`RepositoryListUpdatesService`).
 *
 * It listens only while a page or a list `watch`es, so that no page opens the
 * push channel for it alone _(plan 122's call: a device that was not
 * listening learns it on its next request, through `removed`)_. A removal
 * this tab makes is announced to it with `expect`, and its event is ignored:
 * that tab goes to the repository management page instead (plan 121).
 */
@Injectable({ providedIn: 'root' })
export class RemovedRepositoriesService {
  private readonly push = inject(PushChannelService);
  private readonly drafts = inject(DraftStore);
  private readonly router = inject(Router);

  private readonly viewers = new Set<RemovedRepositoryViewer>();
  /** How many callers watch; the push channel is followed while there is one. */
  private watchers = 0;
  private subscription: Subscription | undefined;
  /** The repositories this tab is removing or removed; their events are its own. */
  private readonly ownRemovals = new Set<number>();

  /**
   * Listens for removals until the caller is destroyed, telling `viewer`, if
   * given, when the repository it shows is removed. Call it in an injection
   * context, such as a component's constructor.
   */
  watch(viewer?: RemovedRepositoryViewer): void {
    const destroyRef = inject(DestroyRef);
    if (viewer) {
      this.viewers.add(viewer);
    }
    if (this.watchers++ === 0) {
      this.subscription = this.push.events.subscribe(event => {
        if (event.type === 'repository.removed') {
          this.removed(event.repositoryId);
        }
      });
    }
    destroyRef.onDestroy(() => {
      if (viewer) {
        this.viewers.delete(viewer);
      }
      if (--this.watchers === 0) {
        this.subscription?.unsubscribe();
        this.subscription = undefined;
      }
    });
  }

  /**
   * Marks the repository `repositoryId` as removed by this tab, so that its
   * event changes nothing here, until the returned function is called, such as
   * when the request failed. Call it before the request, which the event may
   * overtake.
   */
  expect(repositoryId: number): () => void {
    this.ownRemovals.add(repositoryId);
    return () => this.ownRemovals.delete(repositoryId);
  }

  /**
   * Follows the removal of the repository `repositoryId`, from its event or
   * from a request that found it gone: the pages that show it are told and the
   * tab goes to the dashboard, and this device's browser drafts of it are
   * deleted (RM-19). Does nothing for a removal this tab made.
   */
  removed(repositoryId: number): void {
    if (this.ownRemovals.has(repositoryId)) {
      return;
    }
    const shown = [ ...this.viewers ].filter(viewer => viewer.repositoryId() === repositoryId);
    // The pages drop their waiting saves first, so that none writes a draft after the drafts are deleted.
    shown.forEach(viewer => viewer.removed());
    void this.drafts.deleteRepository(repositoryId);
    if (shown.length > 0) {
      void this.router.navigateByUrl('/');
    }
  }
}
