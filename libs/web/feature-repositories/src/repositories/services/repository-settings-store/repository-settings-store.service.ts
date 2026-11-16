import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { PushEvent, RepositoryDetails, RepositorySummary } from '@front-burner/shared-contracts';
import { RepositoriesApi } from '@front-burner/web-api-client';
import { PushChannelService, toApiError } from '@front-burner/web-core';
import { Subscription } from 'rxjs';

/**
 * Where the settings page is with its repository: `loading` until the first
 * answer, `ready` with details, `missing` for a repository that does not exist
 * or is another user's (RM-1), and `failed` when the first load failed.
 */
export type RepositorySettingsState = 'loading' | 'ready' | 'missing' | 'failed';

/**
 * The details of the repository that the settings page shows (RM-9, RM-16),
 * provided by the page so that each of its sections reads the same ones. They
 * follow the repository without a reload: its clone's `job.progress` is
 * patched in place (RM-7), and as events are otherwise notifications only
 * (A-3.11), its status and warnings (`repository.status`,
 * `repository.warning`), a key's lock (`key.locked`, `key.unlocked`, which
 * change "Key locked") and a reconnect read the details again. Only the answer
 * to the latest request counts, and a reload that fails keeps the details on
 * screen.
 */
@Injectable()
export class RepositorySettingsStore {
  private readonly api = inject(RepositoriesApi);

  private readonly current = signal<RepositoryDetails | undefined>(undefined);
  private readonly currentState = signal<RepositorySettingsState>('loading');
  private readonly reloading = signal(false);

  /** The repository's details, once loaded. */
  readonly details = this.current.asReadonly();
  readonly state = this.currentState.asReadonly();
  /** Whether **Try again** after a failed first load is waiting for its answer. */
  readonly retrying = this.reloading.asReadonly();

  private id: number | undefined;
  private request: Subscription | undefined;

  constructor() {
    const push = inject(PushChannelService);
    const destroyRef = inject(DestroyRef);
    push.events.pipe(takeUntilDestroyed(destroyRef)).subscribe(event => {
      if (event.type === 'job.progress') {
        this.progress(event.jobId, event.percent);
      } else if (this.concerns(event)) {
        this.reload();
      }
    });
    push.reconnected.pipe(takeUntilDestroyed(destroyRef)).subscribe(() => this.reload());
    destroyRef.onDestroy(() => this.request?.unsubscribe());
  }

  /** Shows the repository `id`, forgetting the one shown before. */
  load(id: number): void {
    this.id = id;
    this.current.set(undefined);
    this.currentState.set('loading');
    this.fetch();
  }

  /** Reads the details of the shown repository again; nothing for a missing one, which stays missing. */
  reload(): void {
    if (this.id !== undefined && this.currentState() !== 'missing') {
      this.fetch();
    }
  }

  /**
   * Shows `summary`, the API's answer to **Retry clone** or **Clone again**,
   * at once (RM-11): the repository is **Cloning**, and the old error record
   * is gone. The backend announces the clone, and may even finish it, before
   * this answer arrives, so the answer is shown only over the **Error** it
   * replaces, never over what a read has shown since, and the details are read
   * again either way: a read already on its way may describe the failed clone,
   * and progress reported before the answer was not patched in.
   */
  cloning(summary: RepositorySummary): void {
    const details = this.current();
    if (details?.summary.id !== summary.id) {
      return;
    }
    if (details.summary.status === 'error') {
      this.current.set({ ...details, summary, errorDetail: null, errorRequestId: null });
    }
    this.fetch();
  }

  /** **Try again** after the first load failed. */
  retry(): void {
    this.reloading.set(true);
    this.reload();
  }

  /**
   * The progress of the repository's clone, which also means that it runs
   * (RM-7, AR-52), patched in place as the lists do. Other jobs' progress is
   * not about this repository. An answer on its way may show an older
   * percentage, so nothing is read again: the next report corrects it.
   */
  private progress(jobId: number, percent: number): void {
    const details = this.current();
    if (details?.summary.clone?.jobId !== jobId) {
      return;
    }
    this.current.set({ ...details, summary: { ...details.summary, clone: { jobId, state: 'running', percent } } });
  }

  private concerns(event: PushEvent): boolean {
    switch (event.type) {
      case 'repository.status':
      case 'repository.warning':
        return event.repositoryId === this.id;
      case 'key.locked':
      case 'key.unlocked':
        // The details do not name the key, and an unlock is rare: any key may be this repository's.
        return true;
      default:
        return false;
    }
  }

  private fetch(): void {
    const id = this.id as number;
    this.request?.unsubscribe();
    this.request = this.api.repositoryDetails(id).subscribe({
      next: details => {
        this.reloading.set(false);
        this.current.set(details);
        this.currentState.set('ready');
      },
      error: (error: unknown) => {
        this.reloading.set(false);
        if (toApiError(error).code === 'not-found') {
          this.current.set(undefined);
          this.currentState.set('missing');
        } else if (this.current() === undefined) {
          this.currentState.set('failed');
        }
      }
    });
  }
}
