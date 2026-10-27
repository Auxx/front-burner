import { z } from 'zod';
import { REFRESH_TOKEN_DELIVERIES } from './login.schema';

/** Exchanges the one-time code of a completed OIDC login for session tokens (LG-22, LG-23). */
export const OidcExchangeRequestSchema = z
  .object({
    code: z.string().min(1).max(128),
    refreshTokenDelivery: z.enum(REFRESH_TOKEN_DELIVERIES).default('cookie')
  })
  .meta({ id: 'OidcExchangeRequest' });

/**
 * The `oidcError` a failed OIDC login sends the web client back with: the
 * reason codes of LG-43 for OIDC while onboarding is pending (AO-26, AO-34),
 * otherwise `failed`, which hides the reason (LG-21).
 */
export const OIDC_FAILURE_REASONS = [
  'user-disabled',
  'rate-limited',
  'provider-error',
  'provider-unreachable',
  'code-exchange-failed',
  'state-mismatch',
  'invalid-id-token',
  'email-not-verified',
  'registration-disabled',
  'password-user',
  'admin-email-mismatch',
  'failed'
] as const;

export type OidcFailureReason = (typeof OIDC_FAILURE_REASONS)[number];
export type OidcExchangeRequest = z.infer<typeof OidcExchangeRequestSchema>;
