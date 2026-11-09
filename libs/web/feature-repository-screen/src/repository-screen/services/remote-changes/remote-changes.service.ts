import { computed, DestroyRef, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { GitApi } from '@front-burner/web-api-client';
import { isRefusal } from '@front-burner/web-core';
import type { Subscription } from 'rxjs';

import { GitStatusStore, STATUS_RETRY_MS } from '../git-status-store/git-status-store.service';
import { MergeStore } from '../merge-store/merge-store.service';
import { NetworkJobService } from '../network-job/network-job.service';
import { OpenFilesService } from '../open-files/open-files.service';

/** What the remote-change notice says (GA-34). */
export interface RemoteChangeNotice {
  readonly commits: number;
  /** Such as `origin/main`. */
  readonly upstream: string;
  /** Those commits change the open file. */
  readonly touchesOpenFile: boolean;
}

/**
 * The remote-change notice of the open repository (GA-34), derived from state.
 * Provided by the page.
 *
 * The status has the count, as it does for the bar, so that they never disagree.
 * Whether those commits change the open file is read from `GET …/git/incoming`
 * when the count or the open file changes, and only while the notice is to show.
 * Another file only changes that part of the notice, which is not announced; a
 * read that fails leaves it out, and is tried again after `STATUS_RETRY_MS`, unless
 * it was refused. The notice appears when the first read has answered, as what it
 * announces is its text at that moment (RC-25).
 *
 * It does not show during a merge or a pull, here or in another tab. Dismissing
 * remembers the count, so that it comes back only when more commits arrive; when
 * the count falls, what is left is what counts. The memory is per tab and per visit,
 * like the locked-key banner's, and only for this repository, branch and upstream.
 */
@Injectable()
export class RemoteChangesService {
  private readonly api = inject(GitApi);
  private readonly status = inject(GitStatusStore);
  private readonly merge = inject(MergeStore);
  private readonly jobs = inject(NetworkJobService);
  private readonly openFiles = inject(OpenFilesService);

  private readonly commits = computed(() => this.status.status()?.behind ?? 0);
  private readonly upstream = computed(() => this.status.status()?.upstream ?? null);
  private readonly path = computed(() => this.openFiles.current()?.path() ?? null);
  /** Where the count applies; `null` until a status has been read. */
  private readonly place = computed(() => {
    const status = this.status.status();
    return status === null ? null : JSON.stringify([ this.status.followed(), status.branch, status.upstream ]);
  });
  /** What a read's answer is about. */
  private readonly subject = computed(() => JSON.stringify([ this.place(), this.path() ]));

  /** The count when the user dismissed the notice, and where. */
  private readonly dismissal = signal<{ place: string; commits: number; } | null>(null);
  /** The last read's answer; `null` until there is one for the notice to show. */
  private readonly answer = signal<{ subject: string; touches: boolean; } | null>(null);

  private readonly visible = computed(() => {
    const commits = this.commits();
    const dismissal = this.dismissal();
    return this.status.readable() !== null
      && commits > 0
      && this.upstream() !== null
      && !this.merge.merging()
      && this.jobs.running() !== 'pull'
      && !(dismissal?.place === this.place() && commits <= dismissal.commits);
  });

  /** What to show; `null` without a notice. */
  readonly notice = computed<RemoteChangeNotice | null>(() => {
    const answer = this.answer();
    const upstream = this.upstream();
    if (!this.visible() || answer === null || upstream === null) {
      return null;
    }
    return {
      commits: this.commits(),
      upstream,
      touchesOpenFile: answer.subject === this.subject() && answer.touches
    };
  });

  private request: Subscription | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    effect(() => {
      const place = this.place();
      const commits = this.commits();
      untracked(() => this.updateDismissal(place, commits));
    });
    effect(() => {
      const visible = this.visible();
      this.commits();
      const repositoryId = this.status.readable();
      const path = this.path();
      const subject = this.subject();
      untracked(() => {
        this.cancel();
        if (visible && repositoryId !== null) {
          this.read(repositoryId, path, subject);
        } else {
          this.answer.set(null);
        }
      });
    });
    inject(DestroyRef).onDestroy(() => this.cancel());
  }

  /** The user dismissed the notice: it stays away until more commits arrive. */
  dismiss(): void {
    const place = this.place();
    if (place !== null) {
      this.dismissal.set({ place, commits: this.commits() });
    }
  }

  private updateDismissal(place: string | null, commits: number): void {
    const dismissal = this.dismissal();
    if (dismissal === null || place === null) {
      return;
    }
    if (dismissal.place !== place) {
      this.dismissal.set(null);
    } else if (commits < dismissal.commits) {
      this.dismissal.set({ place, commits });
    }
  }

  private read(repositoryId: number, path: string | null, subject: string): void {
    this.request = this.api.incoming(repositoryId, path === null ? undefined : { path }).subscribe({
      next: ({ incoming }) => this.answer.set({ subject, touches: incoming?.touchesPath ?? false }),
      error: error => {
        this.answer.set({ subject, touches: false });
        if (!isRefusal(error)) {
          this.retryTimer = setTimeout(() => this.read(repositoryId, path, subject), STATUS_RETRY_MS);
        }
      }
    });
  }

  private cancel(): void {
    clearTimeout(this.retryTimer);
    this.request?.unsubscribe();
  }
}
