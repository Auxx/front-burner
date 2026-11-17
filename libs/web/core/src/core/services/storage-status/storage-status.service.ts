import { DOCUMENT } from '@angular/common';
import { computed, DestroyRef, effect, inject, Injectable, type Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { InstanceApi } from '@front-burner/web-api-client';
import { catchError, EMPTY, merge, Subject, switchMap, timer } from 'rxjs';

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
 *
 * The disk monitor publishes no event, so the state is read on start, every
 * {@link STORAGE_STATUS_INTERVAL_MS} while the tab is visible, after a push
 * channel reconnect, which may follow a restart, and on `refresh`, which the
 * HTTP interceptor calls after a `low-storage` error, so that a refused clone
 * shows the banner at once _(plan 132's call: a disk fills slowly)_. A read
 * that fails keeps the last state; the next one tries again.
 */
@Injectable({ providedIn: 'root' })
export class StorageStatusService {
  private readonly api = inject(InstanceApi);
  private readonly session = inject(AuthSessionService);
  private readonly currentUser = inject(CurrentUserService);
  private readonly state = signal(false);
  private readonly visible = signal(true);
  private readonly reads = new Subject<void>();

  private readonly administrator = computed(() =>
    this.session.loggedIn() && this.currentUser.user()?.role === 'administrator'
  );

  /** Whether the server was low on storage at the last read. */
  readonly low: Signal<boolean> = this.state.asReadonly();

  constructor() {
    const destroyRef = inject(DestroyRef);
    this.followVisibility(destroyRef);

    effect(() => {
      if (!this.administrator()) {
        this.state.set(false);
      }
    });

    const polling = toObservable(computed(() => this.administrator() && this.visible())).pipe(
      switchMap(active => (active ? timer(0, STORAGE_STATUS_INTERVAL_MS) : EMPTY))
    );
    merge(polling, this.reads, inject(PushChannelService).reconnected).pipe(
      switchMap(() =>
        this.administrator()
          ? this.api.storage().pipe(catchError(() => EMPTY))
          : EMPTY
      ),
      takeUntilDestroyed(destroyRef)
    ).subscribe(({ low }) => {
      // A logout while the request was on its way has turned it off already.
      if (this.administrator()) {
        this.state.set(low);
      }
    });
  }

  /** Reads the state again now, for an administrator; does nothing for anyone else. */
  refresh(): void {
    this.reads.next();
  }

  private followVisibility(destroyRef: DestroyRef): void {
    const document = inject(DOCUMENT);
    const update = () => this.visible.set(document.visibilityState !== 'hidden');
    update();
    document.addEventListener('visibilitychange', update);
    destroyRef.onDestroy(() => document.removeEventListener('visibilitychange', update));
  }
}
