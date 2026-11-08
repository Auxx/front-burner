import { computed, DestroyRef, effect, inject, Injectable, signal, untracked } from '@angular/core';
import type { GitMergeState } from '@front-burner/shared-contracts';
import { GitApi } from '@front-burner/web-api-client';
import { PushChannelService, toApiError } from '@front-burner/web-core';
import { finalize, Subscription } from 'rxjs';

import { GitStatusStore, STATUS_RETRY_MS } from '../git-status-store/git-status-store.service';

/**
 * The open repository's merge in progress (GC-2, A-4.5). Provided by the page.
 *
 * The status says when a merge starts or ends, here or elsewhere, and after a
 * reconnect, so there is no event of its own (A-3.11). The merge itself is read
 * when one starts, on `git.changed`, which resolving a file also publishes, and
 * after every (re)connect, but not on `files.changed`, as that would read the
 * whole merge after every save. A new read cancels the one still running.
 *
 * A read that fails keeps what is known and is tried again after
 * `STATUS_RETRY_MS`, since a normal branch would offer **Push**. A read answered
 * `no-merge-in-progress` means that the merge just ended elsewhere: that counts
 * until the status says there is no merge or an event says something changed.
 * It has to last that long, as the status also says yes during a rebase, which
 * would otherwise be read again after each status read, for ever.
 */
@Injectable()
export class MergeStore {
  private readonly api = inject(GitApi);
  private readonly push = inject(PushChannelService);
  private readonly status = inject(GitStatusStore);

  /** The last merge read, with the repository it belongs to. */
  private readonly read = signal<{ repositoryId: number; state: GitMergeState; } | null>(null);
  /** Whether a read found no merge, though the status said there was one. */
  private readonly ended = signal(false);

  /** Whether a merge is in progress, as of the last status; true before the first read of it. */
  readonly merging = computed(() => this.status.status()?.mergeInProgress === true && !this.ended());
  /** The merge in progress; `null` until it has been read, and at once when it ended or the repository changed. */
  readonly state = computed(() => {
    const read = this.read();
    return this.merging() && read?.repositoryId === this.status.followed() ? read.state : null;
  });
  /** How many of its conflicting files are resolved. */
  readonly resolvedCount = computed(() => this.state()?.files.filter(file => file.resolved).length ?? 0);

  private subscription: Subscription | undefined;
  private request: Subscription | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    effect(() => {
      if (this.status.status()?.mergeInProgress !== true) {
        untracked(() => this.ended.set(false));
      }
    });
    effect(() => {
      const repositoryId = this.status.followed();
      const merging = this.merging();
      untracked(() => {
        // Here and not earlier: the page tells the push channel what it views first (A-3.12).
        if (repositoryId !== null) {
          this.subscription ??= this.follow();
        }
        if (merging) {
          void this.refresh();
        } else {
          this.cancel();
          this.read.set(null);
        }
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.subscription?.unsubscribe();
      this.cancel();
    });
  }

  /**
   * Reads the merge at once, such as after an action of this tab; nothing
   * happens without one. Settles when this read has ended, also when a newer one
   * cancelled it.
   */
  refresh(): Promise<void> {
    this.cancel();
    const repositoryId = this.status.followed();
    if (repositoryId === null || !this.merging()) {
      return Promise.resolve();
    }
    return new Promise(resolve => {
      this.request = this.api.gitMerge(repositoryId).pipe(finalize(resolve)).subscribe({
        next: state => this.read.set({ repositoryId, state }),
        error: error => this.failed(error)
      });
    });
  }

  private failed(error: unknown): void {
    if (toApiError(error).code === 'no-merge-in-progress') {
      this.ended.set(true);
      void this.status.refresh();
    } else {
      this.retryTimer = setTimeout(() => void this.refresh(), STATUS_RETRY_MS);
    }
  }

  private follow(): Subscription {
    const subscription = this.push.reconnected.subscribe(() => this.again());
    subscription.add(this.push.events.subscribe(event => {
      if (event.type === 'git.changed' && event.repositoryId === this.status.followed()) {
        this.again();
      }
    }));
    return subscription;
  }

  /** Something may have changed: what a read found out about the last merge no longer counts. */
  private again(): void {
    this.ended.set(false);
    void this.refresh();
  }

  private cancel(): void {
    clearTimeout(this.retryTimer);
    this.request?.unsubscribe();
  }
}
