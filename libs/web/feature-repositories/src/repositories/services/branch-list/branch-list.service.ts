import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import type { AccessCheckRequest, ApiError, RepositoryCredentials } from '@front-burner/shared-contracts';
import { RepositoriesApi } from '@front-burner/web-api-client';
import { toApiError } from '@front-burner/web-core';
import type { Subscription } from 'rxjs';

/** How long the user must stop typing before the branches are checked _(plan's call for AR-35)_. */
export const BRANCH_LIST_DELAY_MS = 500;

export type BranchListState =
  | { kind: 'idle'; }
  | { kind: 'loading'; }
  | { kind: 'loaded'; branches: string[]; defaultBranch: string | null; }
  | { kind: 'failed'; error: ApiError; };

/**
 * The branch list of a single-branch clone, from an access check (AR-35).
 * Each request replaces the one before: it waits until the user stops
 * typing, cancels a check in flight, and drops an answer for inputs that are
 * no longer current. Provided by the page.
 */
@Injectable()
export class BranchListService {
  private readonly api = inject(RepositoriesApi);

  private readonly current = signal<BranchListState>({ kind: 'idle' });
  readonly state = this.current.asReadonly();

  private latest: AccessCheckRequest | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private subscription: Subscription | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.cancel());
  }

  /** Checks the remote with these inputs, once the user has stopped changing them. */
  request(remoteUrl: string, credentials: RepositoryCredentials): void {
    this.cancel();
    const request = { remoteUrl, credentials };
    this.latest = request;
    this.current.set({ kind: 'loading' });
    this.timer = setTimeout(() => this.run(request), BRANCH_LIST_DELAY_MS);
  }

  /** Checks the last inputs again at once, as **Try again** does. */
  retry(): void {
    const request = this.latest;
    if (request === undefined) {
      return;
    }
    this.cancel();
    this.current.set({ kind: 'loading' });
    this.run(request);
  }

  /** Forgets the inputs, as when the form no longer needs a branch list. */
  reset(): void {
    this.cancel();
    this.latest = undefined;
    this.current.set({ kind: 'idle' });
  }

  private run(request: AccessCheckRequest): void {
    this.timer = undefined;
    this.subscription = this.api.accessCheck(request).subscribe({
      next: ({ branches, defaultBranch }) => {
        if (request === this.latest) {
          this.current.set({ kind: 'loaded', branches, defaultBranch });
        }
      },
      error: (error: unknown) => {
        if (request === this.latest) {
          this.current.set({ kind: 'failed', error: toApiError(error) });
        }
      }
    });
  }

  private cancel(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.subscription?.unsubscribe();
    this.subscription = undefined;
  }
}
