import type { LoginAuditReason } from '@front-burner/server-core-database';
import { OIDC_FAILURE_REASONS, type OidcFailureReason, type OnboardingState } from '@front-burner/shared-contracts';
import type { CookieOptions } from 'express';

/** Binds a pending OIDC login to the browser that started it (LG-17). */
export const OIDC_STATE_COOKIE = 'front_burner_oidc';

/** `Lax`, because the provider's callback is a cross-site navigation. */
export const OIDC_STATE_COOKIE_OPTIONS: CookieOptions = {
  path: '/api/v1/auth/oidc',
  httpOnly: true,
  secure: true,
  sameSite: 'lax'
};

export const OIDC_STATE_COOKIE_MAX_AGE_MS = 10 * 60_000;

/**
 * Where a failed OIDC login sends the browser: the reason only while
 * onboarding is pending (AO-26, AO-34), otherwise `failed` (LG-21).
 */
export function oidcFailureLocation(
  reason: LoginAuditReason,
  state: OnboardingState,
  oidcFromEnvironment: boolean
): string {
  if (state !== 'oidc-pending') {
    return '/login?oidcError=failed';
  }
  const shown = (OIDC_FAILURE_REASONS as readonly string[]).includes(reason)
    ? (reason as OidcFailureReason)
    : 'failed';
  return `${oidcFromEnvironment ? '/login' : '/onboarding'}?oidcError=${shown}`;
}
