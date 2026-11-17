import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { computed, DestroyRef, effect, inject, Injectable, type Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { InstanceApi } from '@front-burner/web-api-client';
import { catchError, EMPTY, merge, Subject, switchMap, tap, timer } from 'rxjs';

import { AuthSessionService } from '../auth-session/auth-session.service';
import { CurrentUserService } from '../current-user/current-user.service';
import { PushChannelService } from '../push-channel/push-channel.service';

/** How often the state is read while an administrator's tab is visible. */
export const STORAGE_STATUS_INTERVAL_MS = 5 * 60_000;

/**
 * Whether the server is low on storage, for the administrators' low-space
 * banner (NF-9.7, NV-15). Only an administrator's tab reads it
 * (`GET /instance/storage`, which is `@AdminOnly()`); for anyone else `low`
 * stays off and no request is made. It waits for the user that the pages
 * with the app header load (`CurrentUserService`), and loads none itself.
 * A `403`, for a user who stopped being an administrator since that load,
 * turns the banner off and stops the reads until the next login.
 *
 * The disk monitor publishes no event, so the state is read on start, every
 * {@link STORAGE_STATUS_INTERVAL_MS} while the tab is visible, after a push
 * channel reconnect, which may follow a restart, and on `refresh`, which the
 * HTTP interceptor calls after a `low-storage` error, so that a refused clone
 * shows the banner at once _(plan 132's call: a disk fills slowly)_. A tab
 * that comes back into view reads at once only when the last read is older
 * than the interval. A read that fails keeps the last state; the next one
 * tries again.
 */
@Injectable({ providedIn: 'root' })
export class StorageStatusService {
  private readonly api = inject(InstanceApi);
  private readonly session = inject(AuthSessionService);
  private readonly currentUser = inject(CurrentUserService);
  private readonly state = signal(false);
  private readonly visible = signal(true);
  /** The backend answered `403`: the user is not an administrator any more. */
  private readonly refused = signal(false);
  private readonly reads = new Subject<void>();
  /** When the last read was answered, in epoch milliseconds. */
  private lastReadAt = Number.NEGATIVE_INFINITY;

  private readonly administrator = computed(() =>
    this.session.loggedIn() && this.currentUser.user()?.role === 'administrator' && !this.refused()
  );

  /** Whether the server was low on storage at the last read. */
  readonly low: Signal<boolean> = this.state.asReadonly();

  constructor() {
    const destroyRef = inject(DestroyRef);
    this.followVisibility(destroyRef);

    effect(() => {
      if (!this.session.loggedIn()) {
        this.refused.set(false);
      }
    });
    effect(() => {
      if (!this.administrator()) {
        this.state.set(false);
        // The next administrator, or the same one after a login, reads at once.
        this.lastReadAt = Number.NEGATIVE_INFINITY;
      }
    });

    const polling = toObservable(computed(() => this.administrator() && this.visible())).pipe(
      switchMap(active => {
        if (!active) {
          return EMPTY;
        }
        const due = Math.max(0, this.lastReadAt + STORAGE_STATUS_INTERVAL_MS - Date.now());
        return timer(due, STORAGE_STATUS_INTERVAL_MS);
      })
    );
    merge(polling, this.reads, inject(PushChannelService).reconnected).pipe(
      switchMap(() => (this.administrator() ? this.read() : EMPTY)),
      takeUntilDestroyed(destroyRef)
    ).subscribe(({ low }) => {
      // A logout while the request was on its way has turned it off already.
      if (this.administrator()) {
        this.lastReadAt = Date.now();
        this.state.set(low);
      }
    });
  }

  /** Reads the state again now, for an administrator; does nothing for anyone else. */
  refresh(): void {
    this.reads.next();
  }

  private read() {
    return this.api.storage().pipe(
      tap({
        error: (error: unknown) => {
          if (error instanceof HttpErrorResponse && error.status === 403) {
            this.refused.set(true);
          }
        }
      }),
      catchError(() => EMPTY)
    );
  }

  private followVisibility(destroyRef: DestroyRef): void {
    const document = inject(DOCUMENT);
    const update = () => this.visible.set(document.visibilityState !== 'hidden');
    update();
    document.addEventListener('visibilitychange', update);
    destroyRef.onDestroy(() => document.removeEventListener('visibilitychange', update));
  }
}
