import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import type { ApiError, OnboardingStatus } from '@front-burner/shared-contracts';
import { OnboardingApi } from '@front-burner/web-api-client';
import { firstValueFrom } from 'rxjs';

import { toApiError } from '../../errors/to-api-error';

/** The onboarding state as the web client knows it, or why it could not be loaded. */
export type OnboardingView =
  | { kind: 'status'; status: OnboardingStatus; }
  | { kind: 'error'; error: ApiError; };

// Clients treat a 404 from the state endpoint as `completed` (AO-3).
const COMPLETED: OnboardingView = {
  kind: 'status',
  status: { state: 'completed', oidcFromEnvironment: false, setupTokenConfigured: false }
};

/** Asks the backend for the onboarding state once per page load (AO-2, AO-3). */
@Injectable({ providedIn: 'root' })
export class OnboardingStateService {
  private readonly api = inject(OnboardingApi);
  private cached: Promise<OnboardingView> | undefined;
  private readonly current = signal<OnboardingView | undefined>(undefined);

  /** The last answer, for pages that show it. */
  readonly view = this.current.asReadonly();

  /** The cached state; a failure is not cached, so the next call asks again. */
  load(): Promise<OnboardingView> {
    this.cached ??= this.fetch();
    return this.cached;
  }

  /** Asks the backend again. */
  refresh(): Promise<OnboardingView> {
    this.cached = undefined;
    return this.load();
  }

  /** After a successful setup, so that the login page opens without asking again. */
  markCompleted(): void {
    this.cached = Promise.resolve(COMPLETED);
    this.current.set(COMPLETED);
  }

  private async fetch(): Promise<OnboardingView> {
    let view: OnboardingView;
    try {
      view = { kind: 'status', status: await firstValueFrom(this.api.status()) };
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 404) {
        view = COMPLETED;
      } else {
        view = { kind: 'error', error: toApiError(error) };
        this.cached = undefined;
      }
    }
    this.current.set(view);
    return view;
  }
}
