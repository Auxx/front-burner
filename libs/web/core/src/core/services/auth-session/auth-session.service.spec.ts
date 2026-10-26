import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { SessionTokens } from '@front-burner/shared-contracts';
import { AuthApi } from '@front-burner/web-api-client';
import { of, throwError } from 'rxjs';

import { AUTH_STORAGE_KEY, AuthSessionService } from './auth-session.service';

const tokens = (authToken: string): SessionTokens => ({
  authToken,
  authTokenExpiresAt: '2026-10-26T10:15:00.000Z',
  refreshTokenExpiresAt: '2026-11-25T10:00:00.000Z'
});

const stored = (authToken: string): string => JSON.stringify(tokens(authToken));

/** Web Locks as the browser runs them for one name: one callback at a time, in order. */
class FakeLocks {
  private tail: Promise<unknown> = Promise.resolve();

  request<T>(_name: string, callback: () => Promise<T>): Promise<T> {
    const run = this.tail.then(() => callback());
    this.tail = run.catch(() => undefined);
    return run;
  }
}

describe('AuthSessionService', () => {
  let api: { login: ReturnType<typeof vi.fn>; refresh: ReturnType<typeof vi.fn>; logout: ReturnType<typeof vi.fn>; };
  let locks: FakeLocks;

  beforeEach(() => {
    localStorage.clear();
    locks = new FakeLocks();
    Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });
    api = { login: vi.fn(), refresh: vi.fn(), logout: vi.fn() };
    TestBed.configureTestingModule({
      providers: [ provideRouter([]), { provide: AuthApi, useValue: api } ]
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
});
