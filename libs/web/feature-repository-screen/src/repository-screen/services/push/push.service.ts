import { computed, DestroyRef, effect, inject, Injectable, signal, untracked } from '@angular/core';
import type { GitJobOutcome } from '@front-burner/shared-contracts';
import { ToastService } from '@front-burner/ui';
import { GitApi } from '@front-burner/web-api-client';
import { PushChannelService, toApiError } from '@front-burner/web-core';
import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

import { pushProblem, type PushProblemText } from '../../utils/push-problem/push-problem';
import { GitStatusStore } from '../git-status-store/git-status-store.service';
import { LockedKeyService } from '../locked-key/locked-key.service';

const KEY = 'web-feature-repository-screen.PushService';

/** The wait before a job whose state could not be read is read again. */
export const JOB_RETRY_MS = 5000;

/** Why a push failed, what to say, and the fix to offer (RC-4, GA-30, GA-31). */
export interface PushProblem extends PushProblemText {
  readonly code: string;
  /** The values of the message, and the remote's own lines in `remoteMessages` (GA-31). */
  readonly params: Readonly<Record<string, string>>;
  /** A push this tab did not start, such as another tab's: shown, but not announced. */
  readonly quiet: boolean;
}

/** The push job followed, and whether this tab started it. */
interface Followed {
  readonly repositoryId: number;
  readonly jobId: number;
  readonly own: boolean;
}

const stringParams = (params: Readonly<Record<string, unknown>>): Record<string, string> =>
  Object.fromEntries(Object.entries(params).map(([ key, value ]) => [ key, String(value) ]));

/**
 * Follows the push of the followed repository (GA-3, GA-9, GA-29 to GA-32).
 * Provided by the page.
 *
 * It follows one job: one it started, or one it takes up from the status's
 * `networkJob`, such as after a reload or a push started in another tab. It reads
 * the job's state on `job.finished` and after every (re)connect, since events
 * are never replayed (A-3.11), so that a `job.finished` missed while offline
 * still ends it. When the job ends, the status is read again, so that the counts
 * update (GA-32).
 *
 * Only the tab that started a push says "Pushed 2 commits to origin/main". A
 * push that failed becomes `problem`, quiet for a push this tab did not start, so
 * that it is not announced. So does a push the backend refused to start, except
 * `409 key-locked`: that asks for the passphrase at once, and the push carries on
 * after the unlock without being started again; cancelling cancels it, with no
 * message (RC-17). It asks once per press, so that a key that is locked again at
 * once shows the problem, with **Unlock**. Nothing is saved first: a push sends
 * what was committed.
 */
@Injectable()
export class PushService {
  private readonly api = inject(GitApi);
  private readonly channel = inject(PushChannelService);
  private readonly store = inject(GitStatusStore);
  private readonly lockedKey = inject(LockedKeyService);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  private readonly followed = signal<Followed | null>(null);
  /** The repository whose push is being asked for, until the backend answers. */
  private readonly starting = signal<number | null>(null);
  private readonly shownProblem = signal<PushProblem | null>(null);
  /** The jobs that have ended, so that a status read before their end does not take them up again. */
  private readonly ended = new Set<number>();
  private retryTimer: ReturnType<typeof setTimeout> | undefined;

  /** Whether a push of the followed repository is being started or runs, in this tab or another. */
  readonly running = computed(() => {
    const repositoryId = this.store.followed();
    return repositoryId !== null
      && (this.starting() === repositoryId || this.followed()?.repositoryId === repositoryId);
  });
  /** Why the last push failed, until it is cleared or another starts. */
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
        });
      }
    });
    effect(() => {
      const job = this.store.status()?.networkJob ?? null;
      const id = this.store.followed();
      untracked(() => {
        if (
          job !== null && id !== null && this.starting() !== id && this.followed()?.jobId !== job.id
          && !this.ended.has(job.id)
        ) {
          this.follow({ repositoryId: id, jobId: job.id, own: false });
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
   * Pushes the current branch (GA-29). Nothing happens while a push is being
   * started or runs. Settles once the backend has queued it, or refused it, and
   * after the passphrase was asked for, if it was (RC-17).
   */
  async start(): Promise<void> {
    const locked = await this.request();
    if (locked !== undefined) {
      await this.unlockAndRetry(locked);
    }
  }

  /**
   * Asks the backend to push; resolves the refusal's params when it refused
   * because the key is locked and `quietLock` is set, which shows nothing, so
   * that the caller can ask for the passphrase.
   */
  private async request(quietLock = true): Promise<Record<string, string> | undefined> {
    const repositoryId = this.store.followed();
    if (repositoryId === null || this.running()) {
      return undefined;
    }
    this.shownProblem.set(null);
    this.starting.set(repositoryId);
    try {
      const { jobId } = await firstValueFrom(this.api.push(repositoryId));
      if (this.store.followed() === repositoryId) {
        this.follow({ repositoryId, jobId, own: true });
      }
    } catch (error) {
      if (this.store.followed() === repositoryId) {
        const apiError = toApiError(error);
        if (quietLock && apiError.code === 'key-locked') {
          return stringParams(apiError.params);
        }
        this.fail(apiError.code, stringParams(apiError.params), false);
        // A refusal such as `nothing-to-push` means the status shown is out of date.
        void this.store.refresh();
      }
    } finally {
      // Another repository's push may have started meanwhile, after a switch.
      if (this.starting() === repositoryId) {
        this.starting.set(null);
      }
    }
    return undefined;
  }

  /** The last push again, such as after its fix (RC-9). */
  retry(): Promise<void> {
    return this.start();
  }

  /**
   * **Unlock** on a push problem (RC-4, RC-16): the push runs again once the key
   * is unlocked. When the key can't be read to ask for it, the problem stays, so
   * that **Unlock** can be tried again.
   */
  async unlockAndRetry(locked: Record<string, string> = this.shownProblem()?.params ?? {}): Promise<void> {
    const repositoryId = this.store.followed();
    let unlocked: boolean;
    try {
      unlocked = await this.lockedKey.unlock();
    } catch {
      if (this.store.followed() === repositoryId) {
        this.fail('key-locked', locked, false);
      }
      return;
    }
    // Not after a switch to another repository while the dialog was open.
    if (unlocked && this.store.followed() === repositoryId) {
      await this.request(false);
    }
  }

  clearProblem(): void {
    this.shownProblem.set(null);
  }

  private follow(followed: Followed): void {
    clearTimeout(this.retryTimer);
    // A new push makes the last one's failure out of date, also one started in another tab.
    this.shownProblem.set(null);
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
    if (outcome?.kind === 'pushed' && followed.own) {
      this.toast.show({
        message: this.transloco.translate(`${KEY}.pushed`, { count: outcome.commits, upstream: outcome.upstream }),
        dismissLabel: this.transloco.translate(`${KEY}.dismiss`),
        status: 'success'
      });
    } else if (outcome?.kind === 'failed') {
      this.fail(outcome.code, outcome.params, !followed.own);
    }
    void this.store.refresh();
  }

  private fail(code: string, params: Record<string, string>, quiet: boolean): void {
    this.shownProblem.set({ code, params, quiet, ...pushProblem(code) });
  }
}
