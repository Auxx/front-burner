import { ApiErrorException } from '@front-burner/server-core-observability';
import { REFRESH_HEADER, type RefreshRequest } from '@front-burner/shared-contracts';
import type { CookieOptions, Request, Response } from 'express';

/** The cookie that holds the refresh token with cookie delivery (LG-31, LG-32). */
export const REFRESH_COOKIE = 'front_burner_refresh';

/** Only the refresh and logout endpoints receive the cookie. */
const OPTIONS: CookieOptions = {
  path: '/api/v1/auth/session',
  httpOnly: true,
  secure: true,
  sameSite: 'strict'
};

export function setRefreshCookie(res: Response, refreshToken: string, expiresAt: Date): void {
  res.cookie(REFRESH_COOKIE, refreshToken, { ...OPTIONS, expires: expiresAt });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, OPTIONS);
}

/**
 * The refresh token of a refresh or logout, from the cookie or the body (LG-31).
 * A cookie counts only with {@link REFRESH_HEADER} and no other site's
 * `Origin`, which a cross-site request cannot fake without CORS (LG-33).
 *
 * @throws ApiErrorException `malformed-request` (400) for a token in both,
 *   `cross-site-refused` (403) for a cookie without those proofs.
 */
export function readRefreshToken(req: Request, body: RefreshRequest): string | undefined {
  const cookie = (req.cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE];
  const fromCookie = typeof cookie === 'string' && cookie !== '' ? cookie : undefined;
  if (fromCookie === undefined) {
    return body.refreshToken;
  }
  if (body.refreshToken !== undefined) {
    throw new ApiErrorException(400, 'malformed-request');
  }
  const origin = req.get('origin');
  if (req.get(REFRESH_HEADER) !== '1' || (origin !== undefined && origin !== `${req.protocol}://${req.get('host')}`)) {
    throw new ApiErrorException(403, 'cross-site-refused');
  }
  return fromCookie;
}
