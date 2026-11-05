import { computed, DestroyRef, effect, inject, Injectable, signal, untracked } from '@angular/core';
import type { GitStatus } from '@front-burner/shared-contracts';
import { GitApi } from '@front-burner/web-api-client';
import { PushChannelService } from '@front-burner/web-core';
import { finalize, Subscription } from 'rxjs';

import { RepositorySessionService } from '../repository-session/repository-session.service';

/**
 * The wait after the last `files.changed` before the status is read again
 * (GA-12). Spike 4: a warm status at 100,000 files takes about 100 ms, so this
 * is the default of plan 45, not a limit of git (A-5.14).
 */
export const STATUS_REFRESH_MS = 2000;

/**
 * The longest a read waits behind `files.changed` events that keep coming, such
 * as saves of several files, which are less than `STATUS_REFRESH_MS` apart: GA-12's
 * "within a few seconds".
 */
export const STATUS_REFRESH_MAX_MS = 5000;

/** The wait before a read that failed is tried again, since an idle repository sends no event. */
export const STATUS_RETRY_MS = 30_000;

/**
 * The open repository's git status, for everything on the repository screen
 * that shows it, so that they never disagree. Provided by the page.
 *
 * It reads the status when the repository is ready, at once on `git.changed`,
 * `STATUS_REFRESH_MS` after the last `files.changed`, so that a burst of saves
 * causes one read, but no later than `STATUS_REFRESH_MAX_MS` after the first, and
 * after every (re)connect, since events are never replayed (A-3.11). A new read
 * cancels the one still running. A read that fails keeps the last status, with
 * `failed` set, since an empty list would look like "no changes", and is tried
 * again after `STATUS_RETRY_MS`.
 */
@Injectable()
export class GitStatusStore {
  private readonly api = inject(GitApi);
  private readonly push = inject(PushChannelService);
  private readonly session = inject(RepositorySessionService);

  private readonly current = signal<GitStatus | null>(null);
  private readonly readFailed = signal(false);
  private readonly repositoryId = signal<number | null>(null);

  /** The repository followed, which changes together with `status`. */
  readonly followed = this.repositoryId.asReadonly();
  /** The last status read; `null` until one has been read for this repository. */
  readonly status = this.current.asReadonly();
  /** Whether the latest read failed. */
  readonly failed = this.readFailed.asReadonly();
  /** How many files have changed, as of the last status read. */
  readonly changeCount = computed(() => this.current()?.changes.length ?? 0);

  /** The repository to read: the followed one, while the session has it open and ready. */
  private readonly readable = computed(() => {
    const id = this.repositoryId();
    return this.session.state() === 'ready' && this.session.repository()?.id === id ? id : null;
  });

  private subscription: Subscription | undefined;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  /** When the first `files.changed` of the current wait came, or `null` without a wait. */
  private waitingSince: number | null = null;
  private request: Subscription | undefined;

  constructor() {
    effect(() => {
      if (this.readable() !== null) {
        untracked(() => void this.refresh());
      }
    });
    inject(DestroyRef).onDestroy(() => {
      this.subscription?.unsubscribe();
      this.cancelWait();
      this.request?.unsubscribe();
    });
  }

  /**
   * Follows the repository `repositoryId`, with nothing of the previous one
   * left. Nothing happens for the repository already followed, so that a new
   * file in the route keeps what is known.
   */
  start(repositoryId: number): void {
    if (repositoryId === this.repositoryId()) {
      return;
    }
    this.repositoryId.set(repositoryId);
    this.cancelWait();
    this.request?.unsubscribe();
    this.current.set(null);
    this.readFailed.set(false);
    this.subscription ??= this.follow();
  }

  /**
   * Reads the status at once, such as after an action of this tab; nothing
   * happens while it cannot be read. Settles when this read has ended, also
   * when a newer one cancelled it.
   */
  refresh(): Promise<void> {
    this.cancelWait();
    const id = this.readable();
    if (id === null) {
      return Promise.resolve();
    }
    return new Promise(resolve => {
      this.request?.unsubscribe();
      this.request = this.api.gitStatus(id).pipe(finalize(resolve)).subscribe({
        next: status => {
          this.current.set(status);
          this.readFailed.set(false);
        },
        error: () => {
          this.readFailed.set(true);
          this.refreshTimer = setTimeout(() => void this.refresh(), STATUS_RETRY_MS);
        }
      });
    });
  }

  private follow(): Subscription {
    // `reconnected` first, as in `TreeSyncService`.
    const subscription = this.push.reconnected.subscribe(() => void this.refresh());
    subscription.add(this.push.events.subscribe(event => {
      if (!('repositoryId' in event) || event.repositoryId !== this.repositoryId()) {
        return;
      }
      if (event.type === 'git.changed') {
        void this.refresh();
      } else if (event.type === 'files.changed') {
        this.waitAfterFilesChanged();
      }
    }));
    return subscription;
  }

  private waitAfterFilesChanged(): void {
    const now = Date.now();
    const since = this.waitingSince ?? now;
    this.cancelWait();
    this.waitingSince = since;
    const wait = Math.min(STATUS_REFRESH_MS, since + STATUS_REFRESH_MAX_MS - now);
    this.refreshTimer = setTimeout(() => void this.refresh(), wait);
  }

  private cancelWait(): void {
    clearTimeout(this.refreshTimer);
    this.waitingSince = null;
  }
}
