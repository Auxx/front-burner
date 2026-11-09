import { computed, DestroyRef, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { GitApi } from '@front-burner/web-api-client';

import { pullUnavailableReason } from '../../utils/git-action-reasons/git-action-reasons';
import { LatestRead } from '../../utils/latest-read/latest-read';
import { GitStatusStore, STATUS_RETRY_MS } from '../git-status-store/git-status-store.service';
import { NetworkJobService } from '../network-job/network-job.service';
import { OpenFilesService } from '../open-files/open-files.service';

/** How long the notice waits for the first read, so that what it announces is whole, before it shows the count alone. */
export const INCOMING_WAIT_MS = 2000;

/** What the remote-change notice says (GA-34). */
export interface RemoteChangeNotice {
  readonly commits: number;
  /** Such as `origin/main`. */
  readonly upstream: string;
  /** Those commits change the open file. */
  readonly touchesOpenFile: boolean;
  /** Whether it says something new when it appears; not when it comes back after a pull that failed. */
  readonly announce: boolean;
}

/** A count of commits to pull, and where it applies. */
interface Count {
  readonly repositoryId: number;
  readonly branch: string | null;
  readonly upstream: string;
  readonly commits: number;
}

/** What a read is about. */
interface Incoming extends Count {
  readonly path: string | null;
}

/** What a read answered. */
interface Answer {
  readonly about: Incoming;
  readonly touches: boolean;
}

function samePlace(one: Count, other: Count): boolean {
  return one.repositoryId === other.repositoryId && one.branch === other.branch && one.upstream === other.upstream;
}

function sameIncoming(one: Incoming | null, other: Incoming | null): boolean {
  if (one === null || other === null) {
    return one === other;
  }
  return samePlace(one, other) && one.commits === other.commits && one.path === other.path;
}

/** Whether a remembered count covers these commits, so that none of them is news. */
function covers(remembered: Count | null, incoming: Count): boolean {
  return remembered !== null && samePlace(remembered, incoming) && incoming.commits <= remembered.commits;
}

/** A remembered count as of now: gone elsewhere or with nothing to pull, and when the count falls, what is left. */
function stillCounting(remembered: Count | null, incoming: Count | null): Count | null {
  if (remembered === null || incoming === null || !samePlace(remembered, incoming)) {
    return null;
  }
  return incoming.commits < remembered.commits ? incoming : remembered;
}

/**
 * The remote-change notice of the open repository (GA-34), derived from state.
 * Provided by the page.
 *
 * The status has the count, as it does for the bar, so that they never disagree.
 * Whether those commits change the open file is read from `GET …/git/incoming`
 * when the count or the open file changes, while the notice is to show. Another
 * file changes only that part of the notice, which is not announced. A read that
 * fails keeps what is known about that file, and says nothing otherwise. The notice
 * appears when the first read has answered, as what it announces is its text at that
 * moment (RC-25), but after `INCOMING_WAIT_MS` at the latest, with the count alone.
 *
 * It shows when **Pull** in the bar is offered (GA-8), so not during a merge, and
 * neither while a pull runs, here or in another tab, nor until the status read after
 * the pull has answered, as until then the status has the count from before it. What
 * was known stays over a pull, so that one that failed brings back the same notice
 * without a read or a second announcement, which could replace the failure's.
 *
 * Dismissing remembers the count, so that it comes back only when more commits
 * arrive; when the count falls, what is left is what counts. The memory is per tab
 * and per visit, like the locked-key banner's, and only for this repository, branch
 * and upstream.
 */
@Injectable()
export class RemoteChangesService {
  private readonly api = inject(GitApi);
  private readonly status = inject(GitStatusStore);
  private readonly jobs = inject(NetworkJobService);
  private readonly openFiles = inject(OpenFilesService);

  /** The commits to pull as of the last status; `null` without any. */
  private readonly incoming = computed<Incoming | null>(() => {
    const status = this.status.status();
    const repositoryId = this.status.followed();
    if (!status?.upstream || status.behind === 0 || repositoryId === null) {
      return null;
    }
    return {
      repositoryId,
      branch: status.branch,
      upstream: status.upstream,
      commits: status.behind,
      path: this.openFiles.current()?.path() ?? null
    };
  }, { equal: sameIncoming });

  /** The count when the user dismissed the notice. */
  private readonly dismissed = signal<Count | null>(null);
  /** The count of the notice shown when a pull started, which the user has already been told. */
  private readonly told = signal<Count | null>(null);
  /** The last read's answer; `null` until there is one for the notice to show. */
  private readonly answer = signal<Answer | null>(null);

  /** What the notice is about while it is to show; `null` otherwise. */
  private readonly shown = computed<Incoming | null>(() => {
    const incoming = this.incoming();
    const hidden = this.status.readable() === null
      || pullUnavailableReason(this.status.status()) !== null
      || this.jobs.running() === 'pull'
      || this.jobs.pullSettling();
    return incoming === null || hidden || covers(this.dismissed(), incoming) ? null : incoming;
  }, { equal: sameIncoming });

  /** What to show; `null` without a notice. */
  readonly notice = computed<RemoteChangeNotice | null>(() => {
    const shown = this.shown();
    const answer = this.answer();
    if (shown === null || answer === null) {
      return null;
    }
    return {
      commits: shown.commits,
      upstream: shown.upstream,
      touchesOpenFile: this.isAboutSameFile(answer, shown) && answer.touches,
      announce: !covers(this.told(), shown)
    };
  });

  private readonly reads = new LatestRead(STATUS_RETRY_MS);
  /** What the last read that was answered was about: there is no need to read that again. */
  private lastRead: Incoming | null = null;
  private waitTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    effect(() => {
      const known = this.status.status() !== null;
      const incoming = this.incoming();
      if (known) {
        untracked(() => {
          this.dismissed.update(count => stillCounting(count, incoming));
          this.told.update(count => stillCounting(count, incoming));
        });
      }
    });
    effect(() => {
      const pulling = this.jobs.running() === 'pull';
      const incoming = this.incoming();
      if (pulling && incoming !== null && untracked(this.answer) !== null) {
        untracked(() => this.told.set(incoming));
      }
    });
    effect(() => {
      const shown = this.shown();
      const incoming = this.incoming();
      untracked(() => this.follow(shown, incoming));
    });
    inject(DestroyRef).onDestroy(() => {
      this.reads.cancel();
      clearTimeout(this.waitTimer);
    });
  }

  /** The user dismissed the notice: it stays away until more commits arrive. */
  dismiss(): void {
    this.dismissed.set(this.incoming());
  }

  private follow(shown: Incoming | null, incoming: Incoming | null): void {
    const answer = this.answer();
    if (incoming === null || (answer !== null && !samePlace(answer.about, incoming))) {
      this.forget();
    }
    if (shown === null) {
      this.reads.cancel();
    } else if (!sameIncoming(this.lastRead, shown)) {
      this.read(shown);
    }
  }

  private read(about: Incoming): void {
    if (this.answer() === null && this.waitTimer === undefined) {
      this.waitTimer = setTimeout(() => {
        this.waitTimer = undefined;
        this.answer.update(answer => answer ?? { about, touches: false });
      }, INCOMING_WAIT_MS);
    }
    const { path } = about;
    void this.reads.run(() => this.api.incoming(about.repositoryId, path === null ? undefined : { path }), {
      next: ({ incoming }) => {
        this.lastRead = about;
        this.answered({ about, touches: incoming?.touchesPath ?? false });
      },
      error: () => {
        const known = this.answer();
        this.answered({ about, touches: known !== null && this.isAboutSameFile(known, about) && known.touches });
      }
    });
  }

  private answered(answer: Answer): void {
    clearTimeout(this.waitTimer);
    this.waitTimer = undefined;
    this.answer.set(answer);
  }

  private forget(): void {
    clearTimeout(this.waitTimer);
    this.waitTimer = undefined;
    this.lastRead = null;
    this.answer.set(null);
  }

  private isAboutSameFile(answer: Answer, incoming: Incoming): boolean {
    return samePlace(answer.about, incoming) && answer.about.path === incoming.path;
  }
}
