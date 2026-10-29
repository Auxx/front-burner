import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import type { RepositoryError, RepositoryStatus, RepositorySummary } from '@front-burner/shared-contracts';
import { RepositoriesApi } from '@front-burner/web-api-client';
import { ApiErrorTextService, toApiError } from '@front-burner/web-core';
import type { Subscription } from 'rxjs';

export type RepositorySessionState = 'loading' | 'missing' | 'not-openable' | 'failed' | 'ready';

/**
 * The repository open on the repository screen. Provided by the page, so that
 * each visit has its own. `start` opens the repository through the API, which
 * sets its last access time (DS-8), once per repository: a new file in the
 * route, a reload of the tree or a reconnect does not open it again (FB-11).
 * The API sets the last access time only for a ready repository, so one that
 * turns ready while the screen shows it as not openable is opened then
 * (`statusChanged`), as this visit's one opening; once opened, it is only
 * read again (`refresh`), which leaves the last access time alone.
 */
@Injectable()
export class RepositorySessionService {
  private readonly api = inject(RepositoriesApi);
  private readonly errorText = inject(ApiErrorTextService);

  private readonly currentState = signal<RepositorySessionState>('loading');
  private readonly current = signal<RepositorySummary | null>(null);
  private readonly failure = signal<{ text: string; reference: string | null; } | null>(null);

  readonly state = this.currentState.asReadonly();
  readonly repository = this.current.asReadonly();
  /** Why opening failed, while `state` is `failed` (A-8.6). */
  readonly error = this.failure.asReadonly();

  private id: number | undefined;
  private request: Subscription | undefined;
  /** Whether this visit has opened the repository while it was ready, which set its last access time. */
  private opened = false;
  /** Whether the status changed while the repository was being opened, so that its answer may be older. */
  private changedMeanwhile = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.request?.unsubscribe());
  }

  /** Opens the repository `id`, unless it is the one already open. */
  start(id: number): void {
    if (id === this.id) {
      return;
    }
    this.id = id;
    this.opened = false;
    this.current.set(null);
    this.open(id);
  }

  /** Opens the repository again after a failure. */
  retry(): void {
    if (this.id !== undefined) {
      this.open(this.id);
    }
  }

  /**
   * Follows a change of the open repository's status, from the push channel
   * (FB-3). One that comes while the repository is being opened is read
   * again once it has opened, since the answer may have been read before it.
   */
  statusChanged(status: RepositoryStatus, error: RepositoryError | null): void {
    const repository = this.current();
    if (this.currentState() === 'loading') {
      this.changedMeanwhile = true;
    } else if (repository !== null) {
      this.follow({ ...repository, status, error });
    }
  }

  /**
   * Reads the repository's status again, without opening it, such as after a
   * reconnect, since events are never replayed (A-3.11). Nothing happens
   * while it is being opened, or when it did not open.
   */
  refresh(): void {
    const state = this.currentState();
    if (this.id === undefined || (state !== 'ready' && state !== 'not-openable')) {
      return;
    }
    this.request?.unsubscribe();
    this.request = this.api.get(this.id).subscribe({
      next: repository => this.follow(repository),
      // The screen stays as it is; the next reconnect reads it again.
      error: () => undefined
    });
  }

  /**
   * Shows the repository's new status: one that could not be opened is
   * opened once it is `ready`, or only shown as ready if this visit opened it
   * already (FB-11); an open one that is no longer `ready`, such as one in
   * `error`, shows the not-openable state.
   */
  private follow(repository: RepositorySummary): void {
    const ready = repository.status === 'ready';
    if (this.currentState() === 'not-openable' && ready && !this.opened && this.id !== undefined) {
      this.open(this.id);
      return;
    }
    this.current.set(repository);
    this.currentState.set(ready ? 'ready' : 'not-openable');
  }

  /** Only the answer to the latest request counts. */
  private open(id: number): void {
    this.request?.unsubscribe();
    this.currentState.set('loading');
    this.failure.set(null);
    this.changedMeanwhile = false;
    this.request = this.api.open(id).subscribe({
      next: repository => {
        this.current.set(repository);
        // Only a ready repository can be opened (FB-3).
        this.opened ||= repository.status === 'ready';
        this.currentState.set(repository.status === 'ready' ? 'ready' : 'not-openable');
        if (this.changedMeanwhile) {
          this.changedMeanwhile = false;
          this.refresh();
        }
      },
      error: (error: unknown) => {
        const apiError = toApiError(error);
        if (apiError.code === 'not-found') {
          this.currentState.set('missing');
          return;
        }
        this.failure.set(this.errorText.describe(apiError));
        this.currentState.set('failed');
      }
    });
  }
}
