import {
  computed,
  DestroyRef,
  effect,
  inject,
  Injectable,
  linkedSignal,
  type Signal,
  signal,
  untracked
} from '@angular/core';
import type { GitConflictFile, GitMergeState } from '@front-burner/shared-contracts';
import { GitApi } from '@front-burner/web-api-client';
import { PushChannelService, toApiError } from '@front-burner/web-core';
import type { Subscription } from 'rxjs';

import { LatestRead } from '../../utils/latest-read/latest-read';
import { GitStatusStore, STATUS_RETRY_MS } from '../git-status-store/git-status-store.service';

/**
 * The file to select in a newly read merge, given the one selected before: it
 * stays while it is listed. Otherwise the first unresolved file after it, by the
 * list's order, or else the first unresolved file, or else the first file, so that
 * the selection never points at nothing (GC-8).
 */
function nextSelection(state: GitMergeState | null, previous: string | null): string | null {
  if (state === null || state.files.length === 0) {
    return null;
  }
  const { files } = state;
  if (previous !== null && files.some(file => file.path === previous)) {
    return previous;
  }
  // Sorted by code units (GitMergeStateSchema), as `<` compares strings.
  const after = previous === null ? undefined : files.find(file => !file.resolved && file.path > previous);
  return (after ?? files.find(file => !file.resolved) ?? files[0]).path;
}

/**
 * The open repository's merge in progress (GC-2, A-4.5). Provided by the page.
 *
 * The status says when a merge starts or ends, here or elsewhere, and after a
 * reconnect, so there is no event of its own (A-3.11). The merge itself is read
 * when one starts, on `git.changed`, which resolving a file also publishes, and
 * after every (re)connect, but not on `files.changed`, as that would read the
 * whole merge after every save. A new read cancels the one still running.
 *
 * It reads only while the session has the repository open and ready. A read that
 * fails keeps what is known, since a normal branch would offer **Push**, and is
 * tried again after `STATUS_RETRY_MS`, unless it was refused. A read answered
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

  /**
   * The conflicting file shown in the editor area (GC-8), by path; `null` without
   * a merge read. The first unresolved file when the merge is first read; one that
   * leaves the list hands over to the next unresolved file after it.
   */
  private readonly selection = linkedSignal<GitMergeState | null, string | null>({
    source: this.state,
    computation: (state, previous) => nextSelection(state, previous?.value ?? null)
  });
  readonly selected: Signal<string | null> = this.selection.asReadonly();
  /** The file at `selected`. */
  readonly selectedFile = computed<GitConflictFile | null>(() => {
    const selected = this.selected();
    return this.state()?.files.find(file => file.path === selected) ?? null;
  });

  private subscription: Subscription | undefined;
  private readonly reads = new LatestRead(STATUS_RETRY_MS);

  constructor() {
    effect(() => {
      if (this.status.status()?.mergeInProgress !== true) {
        untracked(() => this.ended.set(false));
      }
    });
    effect(() => {
      const followed = this.status.followed();
      const readable = this.status.readable();
      const merging = this.merging();
      untracked(() => {
        // Here and not earlier: the page tells the push channel what it views first (A-3.12).
        if (followed !== null) {
          this.subscription ??= this.follow();
        }
        if (merging && readable !== null) {
          void this.refresh();
          return;
        }
        this.reads.cancel();
        if (!merging) {
          this.read.set(null);
          // The next merge starts afresh, whether or not anything read the selection meanwhile.
          this.selection.set(null);
        }
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.subscription?.unsubscribe();
      this.reads.cancel();
    });
  }

  /** Shows a conflicting file in the editor area (GC-8); a path that isn't one is ignored. */
  select(path: string): void {
    if (this.state()?.files.some(file => file.path === path)) {
      this.selection.set(path);
    }
  }

  /**
   * Reads the merge at once, such as after an action of this tab; nothing
   * happens without one. Settles when this read has ended, also when a newer one
   * cancelled it.
   */
  refresh(): Promise<void> {
    this.reads.cancel();
    const repositoryId = this.status.readable();
    if (repositoryId === null || !this.merging()) {
      return Promise.resolve();
    }
    return this.reads.run(() => this.api.gitMerge(repositoryId), {
      next: state => this.read.set({ repositoryId, state }),
      error: error => this.failed(error)
    });
  }

  private failed(error: unknown): void {
    if (toApiError(error).code === 'no-merge-in-progress') {
      this.ended.set(true);
      void this.status.refresh();
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
}
