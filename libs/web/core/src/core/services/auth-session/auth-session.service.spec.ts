import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { SessionTokens } from '@front-burner/shared-contracts';
import { AuthApi, OidcApi } from '@front-burner/web-api-client';
import { of, throwError } from 'rxjs';

import { AUTH_STORAGE_KEY, AuthSessionService } from './auth-session.service';

const tokens = (authToken: string): SessionTokens => ({
  authToken,
  authTokenExpiresAt: '2026-10-26T10:15:00.000Z',
  refreshTokenExpiresAt: '2026-11-25T10:00:00.000Z'
});

const stored = (authToken: string): string => JSON.stringify(tokens(authToken));

/**
 * Web Locks as the browser runs them for one name: one callback at a time, in
 * order; with `ifAvailable`, the callback gets `null` while the lock is held.
 */
class FakeLocks {
  private tail: Promise<unknown> = Promise.resolve();
  private held = 0;

  request<T>(
    _name: string,
    optionsOrCallback: { ifAvailable?: boolean; } | ((lock: object | null) => Promise<T>),
    maybeCallback?: (lock: object | null) => Promise<T>
  ): Promise<T> {
    const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
    if (!callback) {
      throw new TypeError('A lock request needs a callback.');
    }
    const ifAvailable = typeof optionsOrCallback === 'object' && optionsOrCallback.ifAvailable;
    if (ifAvailable && this.held > 0) {
      return callback(null);
    }
    this.held++;
    const run = this.tail.then(() => callback({})).finally(() => this.held--);
    this.tail = run.catch(() => undefined);
    return run;
  }
}

/** What another tab's write looks like to this one: the storage event, after the lock is released. */
function storeFromOtherTab(authToken: string): void {
  localStorage.setItem(AUTH_STORAGE_KEY, stored(authToken));
  window.dispatchEvent(
    new StorageEvent('storage', { key: AUTH_STORAGE_KEY, newValue: stored(authToken), storageArea: localStorage })
  );
}

describe('AuthSessionService', () => {
  let api: { login: ReturnType<typeof vi.fn>; refresh: ReturnType<typeof vi.fn>; logout: ReturnType<typeof vi.fn>; };
  let oidcApi: { exchange: ReturnType<typeof vi.fn>; };
  let locks: FakeLocks;

  beforeEach(() => {
    localStorage.clear();
    locks = new FakeLocks();
    Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });
    api = { login: vi.fn(), refresh: vi.fn(), logout: vi.fn() };
    oidcApi = { exchange: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthApi, useValue: api },
        { provide: OidcApi, useValue: oidcApi }
      ]
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'locks');
  });

  function create(): { service: AuthSessionService; navigate: ReturnType<typeof vi.spyOn>; } {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    return { service: TestBed.inject(AuthSessionService), navigate };
  }

  it('stores the tokens after login and reports loggedIn', async () => {
    api.login.mockReturnValue(of(tokens('first')));
    const { service } = create();
    expect(service.loggedIn()).toBe(false);

    await service.login('ada@example.com', 'secret');

    expect(api.login).toHaveBeenCalledWith({
      email: 'ada@example.com',
      password: 'secret',
      refreshTokenDelivery: 'cookie'
    });
    expect(service.loggedIn()).toBe(true);
    expect(service.authToken()).toBe('first');
    expect(JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) ?? 'null')).toEqual(tokens('first'));
  });

  it('rejects a failed login with the response', async () => {
    const failure = new HttpErrorResponse({ status: 401, error: { code: 'wrong-credentials' } });
    api.login.mockReturnValue(throwError(() => failure));
    const { service } = create();

    await expect(service.login('ada@example.com', 'wrong')).rejects.toBe(failure);
    expect(service.loggedIn()).toBe(false);
  });

  it('completes an OIDC login with the refresh token in a cookie', async () => {
    oidcApi.exchange.mockReturnValue(of(tokens('oidc')));
    const { service } = create();

    await service.completeOidc('one-time-code');

    expect(oidcApi.exchange).toHaveBeenCalledWith({ code: 'one-time-code', refreshTokenDelivery: 'cookie' });
    expect(service.authToken()).toBe('oidc');
    expect(JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) ?? 'null')).toEqual(tokens('oidc'));
  });

  it('rejects a failed OIDC exchange with the response', async () => {
    const failure = new HttpErrorResponse({ status: 401, error: { code: 'oidc-code-invalid' } });
    oidcApi.exchange.mockReturnValue(throwError(() => failure));
    const { service } = create();

    await expect(service.completeOidc('used')).rejects.toBe(failure);
    expect(service.loggedIn()).toBe(false);
  });

  it('restores a stored session', () => {
    localStorage.setItem(AUTH_STORAGE_KEY, stored('kept'));
    const { service } = create();

    expect(service.loggedIn()).toBe(true);
    expect(service.authToken()).toBe('kept');
  });

  it.each([ '{', '{"x":1}', '"token"', '{"authToken":1,"authTokenExpiresAt":"a","refreshTokenExpiresAt":"b"}' ])(
    'treats an unreadable stored session as logged out: %s',
    value => {
      localStorage.setItem(AUTH_STORAGE_KEY, value);
      const { service } = create();

      expect(service.loggedIn()).toBe(false);
      expect(service.authToken()).toBeUndefined();
    }
  );

  it('refreshes once and stores the new token', async () => {
    localStorage.setItem(AUTH_STORAGE_KEY, stored('old'));
    api.refresh.mockReturnValue(of(tokens('new')));
    const { service } = create();

    expect(await service.refresh('old')).toBe('new');
    expect(api.refresh).toHaveBeenCalledTimes(1);
    expect(api.refresh).toHaveBeenCalledWith({});
    expect(service.authToken()).toBe('new');
    expect(JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) ?? 'null')).toEqual(tokens('new'));
  });

  it('refreshes once for requests that failed together', async () => {
    localStorage.setItem(AUTH_STORAGE_KEY, stored('old'));
    api.refresh.mockReturnValue(of(tokens('new')));
    const { service } = create();

    expect(await Promise.all([ service.refresh('old'), service.refresh('old') ])).toEqual([ 'new', 'new' ]);
    expect(api.refresh).toHaveBeenCalledTimes(1);
  });

  it('uses the token another tab stored while it waited', async () => {
    localStorage.setItem(AUTH_STORAGE_KEY, stored('old'));
    const { service } = create();
    // Another tab holds the lock and rotates the token meanwhile.
    let release: (() => void) | undefined;
    const held = locks.request('front-burner.refresh', () => new Promise<void>(resolve => (release = resolve)));
    await vi.waitFor(() => expect(release).toBeDefined());

    const refreshed = service.refresh('old');
    localStorage.setItem(AUTH_STORAGE_KEY, stored('from-other-tab'));
    release?.();
    await held;

    expect(await refreshed).toBe('from-other-tab');
    expect(api.refresh).not.toHaveBeenCalled();
    expect(service.authToken()).toBe('from-other-tab');
  });

  it('refreshes without Web Locks, where the browser has none', async () => {
    Reflect.deleteProperty(navigator, 'locks');
    localStorage.setItem(AUTH_STORAGE_KEY, stored('old'));
    api.refresh.mockReturnValue(of(tokens('new')));
    const { service } = create();

    expect(await Promise.all([ service.refresh('old'), service.refresh('old') ])).toEqual([ 'new', 'new' ]);
    expect(api.refresh).toHaveBeenCalledTimes(1);
  });

  it('expires the session when the refresh fails', async () => {
    localStorage.setItem(AUTH_STORAGE_KEY, stored('old'));
    const failure = new HttpErrorResponse({ status: 401, error: { code: 'refresh-refused' } });
    api.refresh.mockReturnValue(throwError(() => failure));
    const { service, navigate } = create();
    vi.spyOn(TestBed.inject(Router), 'url', 'get').mockReturnValue('/repositories/3?tab=changes');

    await expect(service.refresh('old')).rejects.toBe(failure);

    expect(service.loggedIn()).toBe(false);
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    expect(navigate).toHaveBeenCalledWith([ '/login' ], {
      queryParams: { returnUrl: '/repositories/3?tab=changes' },
      state: { loginMessage: 'session-expired' }
    });
  });

  it('logs out', async () => {
    localStorage.setItem(AUTH_STORAGE_KEY, stored('kept'));
    api.logout.mockReturnValue(of(undefined));
    const { service, navigate } = create();

    await service.logout();

    expect(api.logout).toHaveBeenCalledWith({});
    expect(service.loggedIn()).toBe(false);
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    expect(navigate).toHaveBeenCalledWith([ '/login' ], { state: { loginMessage: 'logged-out' } });
  });

  it('logs out locally when the backend cannot be reached', async () => {
    localStorage.setItem(AUTH_STORAGE_KEY, stored('kept'));
    api.logout.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 0 })));
    const { service, navigate } = create();

    await service.logout();

    expect(service.loggedIn()).toBe(false);
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    expect(navigate).toHaveBeenCalledWith([ '/login' ], { state: { loginMessage: 'logged-out' } });
  });

  it('follows a logout in another tab', () => {
    localStorage.setItem(AUTH_STORAGE_KEY, stored('kept'));
    const { service, navigate } = create();

    localStorage.removeItem(AUTH_STORAGE_KEY);
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: AUTH_STORAGE_KEY,
        oldValue: stored('kept'),
        newValue: null,
        storageArea: localStorage
      })
    );

    expect(service.loggedIn()).toBe(false);
    expect(navigate).toHaveBeenCalledWith([ '/login' ], { state: { loginMessage: 'logged-out' } });
  });

  it('follows a login in another tab', () => {
    const { service, navigate } = create();

    localStorage.setItem(AUTH_STORAGE_KEY, stored('other'));
    window.dispatchEvent(
      new StorageEvent('storage', { key: AUTH_STORAGE_KEY, newValue: stored('other'), storageArea: localStorage })
    );

    expect(service.loggedIn()).toBe(true);
    expect(service.authToken()).toBe('other');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not refresh after another tab logged out', async () => {
    localStorage.setItem(AUTH_STORAGE_KEY, stored('old'));
    const { service, navigate } = create();
    // The other tab's storage event has not arrived yet.
    localStorage.removeItem(AUTH_STORAGE_KEY);

    await expect(service.refresh('old')).rejects.toThrow();
    expect(api.refresh).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(service.loggedIn()).toBe(false);
  });

  it('refreshes from memory where the browser blocks storage', async () => {
    api.login.mockReturnValue(of(tokens('old')));
    api.refresh.mockReturnValue(of(tokens('new')));
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    const { service } = create();
    await service.login('ada@example.com', 'secret');

    expect(await service.refresh('old')).toBe('new');
    setItem.mockRestore();
  });

  it('waits for the token of the tab that held the lock when it arrives late', async () => {
    localStorage.setItem(AUTH_STORAGE_KEY, stored('old'));
    const { service } = create();
    let release: (() => void) | undefined;
    const held = locks.request('front-burner.refresh', () => new Promise<void>(resolve => (release = resolve)));
    await vi.waitFor(() => expect(release).toBeDefined());

    const refreshed = service.refresh('old');
    // Some browsers hand the other tab's write over only after the lock.
    release?.();
    await held;
    setTimeout(() => storeFromOtherTab('from-other-tab'), 20);

    expect(await refreshed).toBe('from-other-tab');
    expect(api.refresh).not.toHaveBeenCalled();
  });

  it('refreshes itself when the tab that held the lock stored nothing', async () => {
    localStorage.setItem(AUTH_STORAGE_KEY, stored('old'));
    api.refresh.mockReturnValue(of(tokens('new')));
    const { service } = create();
    let release: (() => void) | undefined;
    const held = locks.request('front-burner.refresh', () => new Promise<void>(resolve => (release = resolve)));
    await vi.waitFor(() => expect(release).toBeDefined());

    const refreshed = service.refresh('old');
    release?.();
    await held;

    expect(await refreshed).toBe('new');
    expect(api.refresh).toHaveBeenCalledTimes(1);
  });
});
