import { computed, DestroyRef, effect, inject, Injectable, signal, untracked } from '@angular/core';
import type { GitJobOutcome, GitJobStarted, GitNetworkJobType } from '@front-burner/shared-contracts';
import { ToastService } from '@front-burner/ui';
import { GitApi } from '@front-burner/web-api-client';
import { PushChannelService, toApiError } from '@front-burner/web-core';
import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom, type Observable } from 'rxjs';

import { gitProblem, type GitProblemText } from '../../utils/git-problem/git-problem';
import { GitStatusStore } from '../git-status-store/git-status-store.service';
import { LockedKeyService } from '../locked-key/locked-key.service';

const KEY = 'web-feature-repository-screen.NetworkJobService';

/** The wait before a job whose state could not be read is read again. */
export const JOB_RETRY_MS = 5000;

/** Why a network job failed, what to say, and the fix to offer (RC-4, GA-30, GA-31). */
export interface GitProblem extends GitProblemText {
  /** The operation that failed, which **Try again** runs again (RC-9). */
  readonly operation: GitNetworkJobType;
  readonly code: string;
  /** The values of the message, and the remote's own lines in `remoteMessages` (GA-31). */
  readonly params: Readonly<Record<string, string>>;
  /** A job this tab did not start, such as another tab's: shown, but not announced. */
  readonly quiet: boolean;
}

/** The network job followed, and whether this tab started it. */
interface Followed {
  readonly repositoryId: number;
  readonly operation: GitNetworkJobType;
  readonly jobId: number;
  readonly own: boolean;
  /** Started to bring the status up to date, not by the user: its end says nothing. */
  readonly background?: boolean;
}

/** The network job being asked for, until the backend answers. */
interface Starting {
  readonly repositoryId: number;
  readonly operation: GitNetworkJobType;
}

/** A network job waiting for the running one to end. */
interface Waiting extends Starting {
  readonly background: boolean;
}

/** What differs between operations: how the job is started, and what its success says. */
interface Operation {
  readonly start: (api: GitApi, repositoryId: number) => Observable<GitJobStarted>;
  /** The toast for a job this tab started that succeeded, or `null` when the outcome is not its success. */
  readonly succeeded: (outcome: GitJobOutcome) => { key: string; params: Record<string, unknown>; } | null;
}

const OPERATIONS: Readonly<Record<GitNetworkJobType, Operation>> = {
  push: {
    start: (api, repositoryId) => api.push(repositoryId),
    succeeded: outcome =>
      outcome.kind === 'pushed'
        ? { key: `${KEY}.pushed`, params: { count: outcome.commits, upstream: outcome.upstream } }
        : null
  },
  fetch: {
    start: (api, repositoryId) => api.fetch(repositoryId),
    // A fetch that moved this branch's upstream shows in the counts. Otherwise it says so, also when only another
    // branch moved (`moved`), as it would look as if the press did nothing.
    succeeded: outcome => {
      if (outcome.kind !== 'fetched' || outcome.upstreamMoved) {
        return null;
      }
      return { key: `${KEY}.${outcome.moved ? 'noChangesReceived' : 'noNewCommits'}`, params: {} };
    }
  }
};

const stringParams = (params: Readonly<Record<string, unknown>>): Record<string, string> =>
  Object.fromEntries(Object.entries(params).map(([ key, value ]) => [ key, String(value) ]));

/**
 * Follows the network job of the followed repository (GA-3, GA-9, GA-29 to
 * GA-32). Provided by the page.
 *
 * It follows one job, of any operation: one it started, or one it takes up from
 * the status's `networkJob`, such as after a reload or a job started in another
 * tab. What differs by operation is in `OPERATIONS`. It reads the job's state on
 * `job.finished` and after every (re)connect, since events are never replayed
 * (A-3.11), so that a `job.finished` missed while offline still ends it. When
 * the job ends, the status is read again, so that the counts update (GA-32).
 *
 * Only the tab that started a job says "Pushed 2 commits to origin/main", or
 * "No new commits" for a fetch that moved nothing, or "No changes received for
 * this branch" for one that moved only another branch (a fetch that moved the
 * upstream says nothing, the counts update). A job that failed becomes
 * `problem`, quiet for a job this tab did not start, so that it is not
 * announced. So does a job
 * the backend refused to start, except `409 key-locked`: that asks for the
 * passphrase at once, and the job carries on after the unlock without being
 * started again; cancelling cancels it, with no message (RC-17). It asks once
 * per press, so that a key that is locked again at once shows the problem, with
 * **Unlock**. Nothing is saved first: a push sends what was committed, and a
 * fetch changes no file.
 */
@Injectable()
export class NetworkJobService {
  private readonly api = inject(GitApi);
  private readonly channel = inject(PushChannelService);
  private readonly store = inject(GitStatusStore);
  private readonly lockedKey = inject(LockedKeyService);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  private readonly followed = signal<Followed | null>(null);
  private readonly starting = signal<Starting | null>(null);
  private readonly shownProblem = signal<GitProblem | null>(null);
  private readonly waiting = signal<readonly Waiting[]>([]);
  /** The jobs that have ended, so that a status read before their end does not take them up again. */
  private readonly ended = new Set<number>();
  private retryTimer: ReturnType<typeof setTimeout> | undefined;

  /** The operation of the followed repository's network job that is being started or runs, in this tab or another. */
  readonly running = computed<GitNetworkJobType | null>(() => {
    const repositoryId = this.store.followed();
    const starting = this.starting();
    const followed = this.followed();
    if (repositoryId === null) {
      return null;
    }
    if (starting?.repositoryId === repositoryId) {
      return starting.operation;
    }
    return followed?.repositoryId === repositoryId ? followed.operation : null;
  });
  /** Why the last network job failed, until it is cleared or another starts. */
  readonly problem = this.shownProblem.asReadonly();

  constructor() {
    let repositoryId = untracked(this.store.followed);
    effect(() => {
      const followed = this.store.followed();
      if (followed !== repositoryId) {
        repositoryId = followed;
        untracked(() => {
          clearTimeout(this.retryTimer);
          this.followed.set(null);
          this.shownProblem.set(null);
          this.waiting.set([]);
        });
      }
    });
    effect(() => {
      const [ next, ...rest ] = this.waiting();
      if (next !== undefined && this.running() === null) {
        untracked(() => {
          this.waiting.set(rest);
          if (next.repositoryId === this.store.followed()) {
            void this.startNow(next.operation, next.background);
          }
        });
      }
    });
    effect(() => {
      const job = this.store.status()?.networkJob ?? null;
      const id = this.store.followed();
      untracked(() => {
        if (
          job !== null && id !== null && this.starting()?.repositoryId !== id
          && this.followed()?.jobId !== job.id && !this.ended.has(job.id)
        ) {
          this.follow({ repositoryId: id, operation: job.type, jobId: job.id, own: false });
        }
      });
    });
    const subscription = this.channel.reconnected.subscribe(() => {
      const followed = this.followed();
      if (followed !== null) {
        void this.read(followed);
      }
    });
    subscription.add(this.channel.events.subscribe(event => {
      const followed = this.followed();
      if (event.type === 'job.finished' && followed?.jobId === event.jobId) {
        void this.read(followed);
      } else if (event.type === 'key.unlocked' && this.shownProblem()?.params['keyId'] === String(event.keyId)) {
        // Unlocked from the banner or another tab of this session: "Unlock laptop to continue." is out of date.
        this.shownProblem.set(null);
      }
    }));
    inject(DestroyRef).onDestroy(() => {
      subscription.unsubscribe();
      clearTimeout(this.retryTimer);
    });
  }

  /**
   * Starts a network job of the current branch, a push or a fetch (GA-29). Nothing
   * happens while any network job is being started or runs. Settles once the
   * backend has queued it, or refused it, and after the passphrase was asked for,
   * if it was (RC-17).
   */
  async start(operation: GitNetworkJobType): Promise<void> {
    const locked = await this.request(operation);
    if (locked !== undefined) {
      await this.unlockThenRequest(operation, locked);
    }
  }

  /**
   * As `start`, for what must not be lost to a job that runs meanwhile, such as
   * the operation a fix runs again (RC-9): it then waits for that job's end, and
   * for what already waits, unless another repository is opened meanwhile. A
   * `background` job only brings the status up to date: it says nothing of how
   * it ended, and asks for no passphrase. Settles once it has started, or waits.
   */
  async startWhenFree(operation: GitNetworkJobType, options: { background?: boolean; } = {}): Promise<void> {
    const repositoryId = this.store.followed();
    const background = options.background ?? false;
    if (repositoryId === null) {
      return;
    }
    if (this.running() === null && this.waiting().length === 0) {
      await this.startNow(operation, background);
    } else {
      this.waiting.update(waiting => [ ...waiting, { repositoryId, operation, background } ]);
    }
  }

  private async startNow(operation: GitNetworkJobType, background: boolean): Promise<void> {
    if (background) {
      await this.request(operation, false, true);
    } else {
      await this.start(operation);
    }
  }

  /**
   * Asks the backend to start the job; resolves the refusal's params when it
   * refused because the key is locked and `quietLock` is set, which shows
   * nothing, so that the caller can ask for the passphrase. A `background` job
   * leaves the problem shown alone, and a refusal shows nothing.
   */
  private async request(
    operation: GitNetworkJobType,
    quietLock = true,
    background = false
  ): Promise<Record<string, string> | undefined> {
    const repositoryId = this.store.followed();
    if (repositoryId === null || this.running() !== null) {
      return undefined;
    }
    if (!background) {
      this.shownProblem.set(null);
    }
    const starting: Starting = { repositoryId, operation };
    this.starting.set(starting);
    try {
      const { jobId } = await firstValueFrom(OPERATIONS[operation].start(this.api, repositoryId));
      if (this.store.followed() === repositoryId) {
        this.follow({ repositoryId, operation, jobId, own: !background, background });
      }
    } catch (error) {
      if (!background && this.store.followed() === repositoryId) {
        const apiError = toApiError(error);
        if (quietLock && apiError.code === 'key-locked') {
          return stringParams(apiError.params);
        }
        this.fail(operation, apiError.code, stringParams(apiError.params), false);
        // A refusal such as `nothing-to-push` means the status shown is out of date.
        void this.store.refresh();
      }
    } finally {
      // Another repository's job may have started meanwhile, after a switch.
      if (this.starting() === starting) {
        this.starting.set(null);
      }
    }
    return undefined;
  }

  /**
   * The failed operation again, such as after its fix (RC-9): the problem's, so
   * that a job taken up from the status runs as what it was. Nothing without a problem.
   */
  async retry(): Promise<void> {
    const operation = this.shownProblem()?.operation;
    if (operation !== undefined) {
      await this.start(operation);
    }
  }

  /**
   * **Unlock** on a problem (RC-4, RC-16): the operation runs again once the key
   * is unlocked. When the key can't be read to ask for it, the problem stays, so
   * that **Unlock** can be tried again.
   */
  async unlockAndRetry(): Promise<void> {
    const problem = this.shownProblem();
    if (problem !== null) {
      await this.unlockThenRequest(problem.operation, problem.params);
    }
  }

  private async unlockThenRequest(
    operation: GitNetworkJobType,
    locked: Readonly<Record<string, string>>
  ): Promise<void> {
    const repositoryId = this.store.followed();
    let unlocked: boolean;
    try {
      unlocked = await this.lockedKey.unlock();
    } catch {
      if (this.store.followed() === repositoryId) {
        this.fail(operation, 'key-locked', locked, false);
      }
      return;
    }
    // Not after a switch to another repository while the dialog was open.
    if (unlocked && this.store.followed() === repositoryId) {
      await this.request(operation, false);
    }
  }

  clearProblem(): void {
    this.shownProblem.set(null);
  }

  private follow(followed: Followed): void {
    clearTimeout(this.retryTimer);
    // A new job makes the last one's failure out of date, also one started in another tab.
    if (followed.background !== true) {
      this.shownProblem.set(null);
    }
    this.followed.set(followed);
    // It may have ended before it was followed: its `job.finished` came first.
    void this.read(followed);
  }

  /** Reads the job's state, and ends it if it has ended; a read that failed is tried again. */
  private async read(followed: Followed): Promise<void> {
    clearTimeout(this.retryTimer);
    try {
      const state = await firstValueFrom(this.api.gitJob(followed.repositoryId, followed.jobId));
      if (this.followed() === followed && state.status !== 'queued' && state.status !== 'running') {
        this.end(followed, state.outcome);
      }
    } catch (error) {
      if (this.followed() !== followed) {
        return;
      }
      if (toApiError(error).code === 'not-found') {
        this.end(followed, null);
      } else {
        this.retryTimer = setTimeout(() => void this.read(followed), JOB_RETRY_MS);
      }
    }
  }

  private end(followed: Followed, outcome: GitJobOutcome | null): void {
    this.ended.add(followed.jobId);
    this.followed.set(null);
    const success = outcome === null || !followed.own ? null : OPERATIONS[followed.operation].succeeded(outcome);
    if (success !== null) {
      this.toast.show({
        message: this.transloco.translate(success.key, success.params),
        dismissLabel: this.transloco.translate(`${KEY}.dismiss`),
        status: 'success'
      });
    } else if (outcome?.kind === 'failed' && followed.background !== true) {
      this.fail(followed.operation, outcome.code, outcome.params, !followed.own);
    }
    void this.store.refresh();
  }

  private fail(operation: GitNetworkJobType, code: string, params: Record<string, string>, quiet: boolean): void {
    this.shownProblem.set({ operation, code, params, quiet, ...gitProblem(code) });
  }
}
