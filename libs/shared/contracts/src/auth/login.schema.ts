import { z } from 'zod';

/** Where a client receives its refresh token (LG-31). */
export const REFRESH_TOKEN_DELIVERIES = [ 'cookie', 'body' ] as const;

export type RefreshTokenDelivery = (typeof REFRESH_TOKEN_DELIVERIES)[number];

/**
 * A username + password login. No password policy applies (LG-11), and the
 * password is never trimmed (LG-12). 1024 characters bound the hashing cost.
 */
export const LoginRequestSchema = z
  .object({
    email: z.string().trim().pipe(z.email().max(254)),
    password: z.string().min(1).max(1024),
    refreshTokenDelivery: z.enum(REFRESH_TOKEN_DELIVERIES).default('cookie')
  })
  .meta({ id: 'LoginRequest' });

/**
 * The tokens of a session (LG-27, LG-31). With cookie delivery the refresh
 * token is in an `HttpOnly` cookie and not in the body. These are the only
 * secrets a response carries, and only to the client that logged in (A-3.5).
 */
export const SessionTokensSchema = z
  .object({
    authToken: z.string(),
    authTokenExpiresAt: z.iso.datetime(),
    refreshTokenExpiresAt: z.iso.datetime(),
    refreshToken: z.string().optional()
  })
  .meta({ id: 'SessionTokens' });

/** A refresh or a logout; the token is left out when it is in the cookie. */
export const RefreshRequestSchema = z
  .object({ refreshToken: z.string().min(1).max(256).optional() })
  .meta({ id: 'RefreshRequest' });

/** Whether OIDC login can be offered (LG-7, LG-8). */
export const OIDC_AVAILABILITY = [ 'not-configured', 'available', 'unavailable' ] as const;

export type OidcAvailability = (typeof OIDC_AVAILABILITY)[number];

/** The login methods of the instance; the password form is always available. */
export const LoginMethodsSchema = z
  .object({ oidc: z.enum(OIDC_AVAILABILITY), passwordReset: z.boolean() })
  .meta({ id: 'LoginMethods' });

/** The header a cookie-based refresh or logout must carry with the value `1` (LG-33). */
export const REFRESH_HEADER = 'X-Front-Burner-Refresh';

export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type SessionTokens = z.infer<typeof SessionTokensSchema>;
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;
export type LoginMethods = z.infer<typeof LoginMethodsSchema>;
