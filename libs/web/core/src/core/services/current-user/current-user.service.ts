import { effect, inject, Injectable, signal } from '@angular/core';
import type { CurrentUser } from '@front-burner/shared-contracts';
import { MeApi } from '@front-burner/web-api-client';
import { firstValueFrom } from 'rxjs';

import { AuthSessionService } from '../auth-session/auth-session.service';

/** The logged-in user, loaded once per session; forgotten on logout. */
@Injectable({ providedIn: 'root' })
export class CurrentUserService {
  private readonly api = inject(MeApi);
  private readonly session = inject(AuthSessionService);
  private cached: Promise<CurrentUser> | undefined;
  private readonly current = signal<CurrentUser | undefined>(undefined);

  readonly user = this.current.asReadonly();

  constructor() {
    effect(() => {
      if (!this.session.loggedIn()) {
        this.cached = undefined;
        this.current.set(undefined);
      }
    });
  }

  /** The cached user; a failure is not cached, so the next call asks again. */
  load(): Promise<CurrentUser> {
    this.cached ??= this.fetch();
    return this.cached;
  }

  private async fetch(): Promise<CurrentUser> {
    try {
      const user = await firstValueFrom(this.api.current());
      // A logout while the request was on its way has forgotten the user already.
      if (this.cached !== undefined && this.session.loggedIn()) {
        this.current.set(user);
      }
      return user;
    } catch (error) {
      this.cached = undefined;
      throw error;
    }
  }
}
