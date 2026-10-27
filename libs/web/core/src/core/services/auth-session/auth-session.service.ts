import { DOCUMENT } from '@angular/common';
import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { SessionTokens } from '@front-burner/shared-contracts';
import { AuthApi } from '@front-burner/web-api-client';
import { firstValueFrom } from 'rxjs';

import type { LoginMessage } from '../../models/login-message.model';

/** The `localStorage` key of the session (LG-40). */
export const AUTH_STORAGE_KEY = 'front-burner.auth';

/** One refresh at a time across all tabs of the web client (LG-40). */
const REFRESH_LOCK = 'front-burner.refresh';

const LOGIN = '/login';

/** How long a tab that waited for the refresh lock waits for the other tab's new token. */
const OTHER_TAB_WAIT_MS = 250;

/** What is stored: never the refresh token, which stays in its cookie (LG-40). */
interface StoredSession {
  authToken: string;
  authTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
}

/** The stored session, or `undefined` for anything else, such as another version's shape. */
function parse(value: string | null): StoredSession | undefined {
  if (value === null) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return undefined;
  }
  const { authToken, authTokenExpiresAt, refreshTokenExpiresAt } = parsed as Record<string, unknown>;
  return typeof authToken === 'string' && typeof authTokenExpiresAt === 'string'
      && typeof refreshTokenExpiresAt === 'string'
    ? { authToken, authTokenExpiresAt, refreshTokenExpiresAt }
    : undefined;
}

/**
 * The auth session of the web client (LG-39, LG-40): the auth token and the
 * expiry times in `localStorage`, the refresh token in its `HttpOnly` cookie.
 * Follows logins and logouts of the other tabs (NV-8).
 */
@Injectable({ providedIn: 'root' })
export class AuthSessionService {
  private readonly api = inject(AuthApi);
  private readonly router = inject(Router);
  private readonly window = inject(DOCUMENT).defaultView;

  private readonly session = signal<StoredSession | undefined>(this.read());
  /** Serialises refreshes in this tab where the browser has no Web Locks (insecure contexts, LG-68). */
  private localLock: Promise<unknown> = Promise.resolve();
  /** Whether the session could be stored; without storage it lives in this tab only. */
  private storageWorks = true;

  readonly loggedIn = computed(() => this.session() !== undefined);

  constructor() {
    const listener = (event: StorageEvent) => this.followOtherTab(event);
    this.window?.addEventListener('storage', listener);
    inject(DestroyRef).onDestroy(() => this.window?.removeEventListener('storage', listener));
  }

  authToken(): string | undefined {
    return this.session()?.authToken;
  }

  /** Logs in with the refresh token in a cookie; rejects with the `HttpErrorResponse`. */
  async login(email: string, password: string): Promise<void> {
    this.store(await firstValueFrom(this.api.login({ email, password, refreshTokenDelivery: 'cookie' })));
  }

  /**
   * A new auth token for one that the backend reported as expired. A tab that
   * waited for the lock uses the token another tab stored meanwhile, because
   * refreshing with a rotated refresh token revokes the session (LG-36). On
   * failure the session expires and the promise rejects.
   */
  refresh(failedToken: string): Promise<string> {
    return this.withLock(async waited => {
      // Where storage works it is the truth: no session there means another tab
      // logged out, and this tab follows it on the storage event.
      let current = this.storageWorks ? this.read() : this.session();
      if (waited && current?.authToken === failedToken) {
        // The tab that held the lock has most likely refreshed, but some
        // browsers (Firefox) hand its write over only after the lock.
        current = await this.tokenFromOtherTab(failedToken);
      }
      if (current === undefined) {
        this.session.set(undefined);
        throw new Error('The session ended in another tab.');
      }
      if (current.authToken !== failedToken) {
        this.session.set(current);
        return current.authToken;
      }
      let tokens: SessionTokens;
      try {
        tokens = await firstValueFrom(this.api.refresh({}));
      } catch (error) {
        await this.expire(this.router.url);
        throw error;
      }
      this.store(tokens);
      return tokens.authToken;
    });
  }

  /** Revokes the session; works even if the backend cannot be reached (LG-39). */
  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.api.logout({}), { defaultValue: undefined });
    } catch {
      // The auth token is removed all the same.
    }
    this.clear();
    await this.showLogin('logged-out');
  }

  /** Ends a session the backend no longer accepts and remembers where the user was (LG-4, LG-40). */
  async expire(returnUrl?: string): Promise<void> {
    this.clear();
    await this.showLogin('session-expired', returnUrl);
  }

  /** Runs `callback` under the refresh lock; `waited` tells whether another tab held it. */
  private async withLock<T>(callback: (waited: boolean) => Promise<T>): Promise<T> {
    const locks = this.window?.navigator.locks;
    if (locks) {
      return locks.request(
        REFRESH_LOCK,
        { ifAvailable: true },
        lock => lock ? callback(false) : locks.request(REFRESH_LOCK, () => callback(true))
      );
    }
    // Within one tab a refresh updates the session at once: there is nothing to wait for.
    const run = this.localLock.then(() => callback(false));
    this.localLock = run.catch(() => undefined);
    return run;
  }

  /** The session once another tab's new token arrives, or what is stored after a short wait. */
  private tokenFromOtherTab(failedToken: string): Promise<StoredSession | undefined> {
    return new Promise(resolve => {
      const done = () => {
        clearTimeout(timer);
        this.window?.removeEventListener('storage', listener);
        resolve(this.read());
      };
      const listener = (event: StorageEvent) => {
        if (event.key === AUTH_STORAGE_KEY && parse(event.newValue)?.authToken !== failedToken) {
          done();
        }
      };
      const timer = setTimeout(done, OTHER_TAB_WAIT_MS);
      this.window?.addEventListener('storage', listener);
    });
  }

  private followOtherTab(event: StorageEvent): void {
    if (event.key !== AUTH_STORAGE_KEY && event.key !== null) {
      return;
    }
    const session = parse(event.newValue);
    const wasLoggedIn = this.loggedIn();
    this.session.set(session);
    if (session === undefined && wasLoggedIn) {
      void this.showLogin('logged-out');
    }
  }

  private async showLogin(loginMessage: LoginMessage, returnUrl?: string): Promise<void> {
    await this.router.navigate([ LOGIN ], {
      ...(returnUrl === undefined ? {} : { queryParams: { returnUrl } }),
      state: { loginMessage }
    });
  }

  private read(): StoredSession | undefined {
    try {
      return parse(this.window?.localStorage.getItem(AUTH_STORAGE_KEY) ?? null);
    } catch {
      // Storage blocked by the browser.
      return undefined;
    }
  }

  private store({ authToken, authTokenExpiresAt, refreshTokenExpiresAt }: SessionTokens): void {
    const session: StoredSession = { authToken, authTokenExpiresAt, refreshTokenExpiresAt };
    this.session.set(session);
    try {
      this.window?.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
      this.storageWorks = true;
    } catch {
      this.storageWorks = false;
      // Without storage the session lasts as long as the tab.
    }
  }

  private clear(): void {
    this.session.set(undefined);
    try {
      this.window?.localStorage.removeItem(AUTH_STORAGE_KEY);
    } catch {
      // Nothing was stored.
    }
  }
}
