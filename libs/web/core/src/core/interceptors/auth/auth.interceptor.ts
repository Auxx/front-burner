import { HttpErrorResponse, type HttpInterceptorFn, type HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
// A type only: a value import of the contracts would bring Zod into the initial bundle (NF-2.9).
import type { REFRESH_HEADER as ContractsRefreshHeader } from '@front-burner/shared-contracts';
import { catchError, from, switchMap, throwError } from 'rxjs';

import { AuthSessionService } from '../../services/auth-session/auth-session.service';

const REFRESH_HEADER: typeof ContractsRefreshHeader = 'X-Front-Burner-Refresh';

const API = '/api/v1/';
const SESSION = '/api/v1/auth/session/';
const AUTH = '/api/v1/auth/';
const ONBOARDING = '/api/v1/onboarding';

function withToken(request: HttpRequest<unknown>, token: string): HttpRequest<unknown> {
  return request.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
}

function is401(error: unknown): error is HttpErrorResponse {
  return error instanceof HttpErrorResponse && error.status === 401;
}

function errorCode(error: HttpErrorResponse): unknown {
  const body: unknown = error.error;
  return typeof body === 'object' && body !== null ? (body as { code?: unknown; }).code : undefined;
}

/**
 * Adds the auth token to API requests and the refresh header to cookie-based
 * refreshes and logouts (LG-33). When the token has expired it is refreshed and
 * the request retried **once** (LG-40); any other 401 ends the session.
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const url = request.url;
  if (url.startsWith(SESSION)) {
    return next(request.clone({ setHeaders: { [REFRESH_HEADER]: '1' } }));
  }
  const open = url.startsWith(AUTH) || url === ONBOARDING || url.startsWith(`${ONBOARDING}/`);
  if (!url.startsWith(API) || open) {
    return next(request);
  }
  const session = inject(AuthSessionService);
  const router = inject(Router);
  const token = session.authToken();
  if (token === undefined) {
    return next(request);
  }

  // A 401 ends the session only while the token it was sent with is still the
  // current one: after a logout, or a new login meanwhile, it is old news.
  const expire = (sent: string) => (error: unknown) => {
    if (is401(error) && session.authToken() === sent) {
      void session.expire(router.url);
    }
    return throwError(() => error);
  };

  return next(withToken(request, token)).pipe(
    catchError(error => {
      if (!is401(error) || errorCode(error) !== 'auth-token-expired') {
        return expire(token)(error);
      }
      return from(session.refresh(token)).pipe(
        // A failed refresh has already expired the session.
        catchError(() => throwError(() => error)),
        switchMap(refreshed => next(withToken(request, refreshed)).pipe(catchError(expire(refreshed))))
      );
    })
  );
};
