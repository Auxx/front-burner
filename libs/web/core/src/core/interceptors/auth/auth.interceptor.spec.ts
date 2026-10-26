import { HttpClient, HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { AuthSessionService } from '../../services/auth-session/auth-session.service';
import { authInterceptor } from './auth.interceptor';

const UNAUTHORIZED = { status: 401, statusText: 'Unauthorized' };
const apiError = (code: string) => ({ code, params: {}, requestId: 'abcdef123456', message: code });

describe('authInterceptor', () => {
  let session: {
    authToken: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
    expire: ReturnType<typeof vi.fn>;
  };
  let http: HttpClient;
  let backend: HttpTestingController;

  beforeEach(() => {
    session = {
      authToken: vi.fn(() => 'old'),
      refresh: vi.fn(() => Promise.resolve('new')),
      expire: vi.fn(() => Promise.resolve())
    };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([ authInterceptor ])),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AuthSessionService, useValue: session }
      ]
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  /** Lets the refresh promise settle before the retried request is expected. */
  const settle = () => new Promise(resolve => setTimeout(resolve));

  it('adds the token', () => {
    void firstValueFrom(http.get('/api/v1/me'));

    const request = backend.expectOne('/api/v1/me').request;
    expect(request.headers.get('Authorization')).toBe('Bearer old');
    expect(request.headers.has('X-Front-Burner-Refresh')).toBe(false);
  });

  it('adds no token without a session', () => {
    session.authToken.mockReturnValue(undefined);
    void firstValueFrom(http.get('/api/v1/me'));

    expect(backend.expectOne('/api/v1/me').request.headers.has('Authorization')).toBe(false);
  });

  it.each([
    '/api/v1/auth/login',
    '/api/v1/auth/methods',
    '/api/v1/onboarding',
    '/api/v1/onboarding/password-setup',
    'i18n/en.json'
  ])(
    'adds no token to login or onboarding: %s',
    url => {
      void firstValueFrom(http.get(url));

      expect(backend.expectOne(url).request.headers.has('Authorization')).toBe(false);
    }
  );

  it.each([ '/api/v1/auth/session/refresh', '/api/v1/auth/session/logout' ])(
    'adds the refresh header to refresh and logout: %s',
    url => {
      void firstValueFrom(http.post(url, {}));

      const request = backend.expectOne(url).request;
      expect(request.headers.get('X-Front-Burner-Refresh')).toBe('1');
      expect(request.headers.has('Authorization')).toBe(false);
    }
  );

  it('refreshes and retries an expired token', async () => {
    const response = firstValueFrom(http.get('/api/v1/me'));
    backend.expectOne('/api/v1/me').flush(apiError('auth-token-expired'), UNAUTHORIZED);
    await settle();

    const retried = backend.expectOne('/api/v1/me');
    expect(retried.request.headers.get('Authorization')).toBe('Bearer new');
    retried.flush({ id: 1 });

    expect(await response).toEqual({ id: 1 });
    expect(session.refresh).toHaveBeenCalledExactlyOnceWith('old');
    expect(session.expire).not.toHaveBeenCalled();
  });

  it('retries only once', async () => {
    const response = firstValueFrom(http.get('/api/v1/me'));
    backend.expectOne('/api/v1/me').flush(apiError('auth-token-expired'), UNAUTHORIZED);
    await settle();
    backend.expectOne('/api/v1/me').flush(apiError('auth-token-expired'), UNAUTHORIZED);

    await expect(response).rejects.toBeInstanceOf(HttpErrorResponse);
    await settle();
    expect(session.refresh).toHaveBeenCalledTimes(1);
    expect(session.expire).toHaveBeenCalledExactlyOnceWith('/');
    backend.expectNone('/api/v1/me');
  });

  it('expires the session on unauthenticated', async () => {
    const response = firstValueFrom(http.get('/api/v1/me'));
    backend.expectOne('/api/v1/me').flush(apiError('unauthenticated'), UNAUTHORIZED);

    await expect(response).rejects.toMatchObject({ status: 401 });
    expect(session.refresh).not.toHaveBeenCalled();
    expect(session.expire).toHaveBeenCalledExactlyOnceWith('/');
  });

  it('rethrows when the refresh fails, which has expired the session already', async () => {
    session.refresh.mockRejectedValue(new HttpErrorResponse({ status: 401, error: apiError('refresh-refused') }));
    const response = firstValueFrom(http.get('/api/v1/me'));
    backend.expectOne('/api/v1/me').flush(apiError('auth-token-expired'), UNAUTHORIZED);

    await expect(response).rejects.toMatchObject({ status: 401 });
    expect(session.expire).not.toHaveBeenCalled();
  });

  it('passes other errors through', async () => {
    const response = firstValueFrom(http.get('/api/v1/me'));
    backend.expectOne('/api/v1/me').flush(apiError('internal'), { status: 500, statusText: 'Internal Server Error' });

    await expect(response).rejects.toMatchObject({ status: 500 });
    expect(session.refresh).not.toHaveBeenCalled();
    expect(session.expire).not.toHaveBeenCalled();
  });
});
