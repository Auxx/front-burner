import { z } from 'zod';
import { PasswordSchema, refinePasswordNotEmail } from '../auth/password-policy';

/** The onboarding states of REQ-AUTH-001. */
export const ONBOARDING_STATES = [ 'required', 'oidc-pending', 'completed' ] as const;

export type OnboardingState = (typeof ONBOARDING_STATES)[number];

/** What clients need to decide what to show (AO-5); no secrets. */
export const OnboardingStatusSchema = z
  .object({
    state: z.enum(ONBOARDING_STATES),
    oidcFromEnvironment: z.boolean(),
    setupTokenConfigured: z.boolean()
  })
  .meta({ id: 'OnboardingStatus' });

// The setup token is compared exactly as sent: never trimmed.
const setupToken = z.string().min(1);

export const SetupTokenRequestSchema = z.object({ setupToken }).meta({ id: 'SetupTokenRequest' });

/**
 * The fields of the username + password path (AO-17), for forms that build
 * their own object around them. Zod cannot extend a refined object, so a form
 * re-applies {@link refinePasswordNotEmail} itself.
 */
export const passwordSetupFields = {
  email: z.string().trim().pipe(z.email().max(254)),
  displayName: z.string().trim().min(1).max(100),
  password: PasswordSchema
};

export const PasswordSetupRequestSchema = z
  .object({ setupToken, ...passwordSetupFields })
  .superRefine(refinePasswordNotEmail)
  .meta({ id: 'PasswordSetupRequest' });

/** The scopes an OIDC setup uses when none are given (AO-21). */
export const DEFAULT_OIDC_SCOPES = 'openid email profile';

/**
 * The fields of the OIDC path (AO-21). The client secret is never trimmed; an
 * empty or missing one keeps the saved secret (AO-26).
 */
export const oidcSetupFields = {
  issuer: z
    .url({ protocol: /^https$/ })
    .max(2048)
    .refine(issuer => !issuer.includes('?') && !issuer.includes('#'), { params: { code: 'query-or-fragment' } }),
  clientId: z.string().trim().min(1).max(256),
  clientSecret: z.string().max(1024).optional(),
  scopes: z
    .string()
    .trim()
    .max(512)
    .default(DEFAULT_OIDC_SCOPES)
    .refine(scopes => scopes.split(/\s+/).includes('openid'), { params: { code: 'missing-openid' } }),
  requireVerifiedEmail: z.boolean().default(true),
  adminEmail: z.string().trim().pipe(z.email().max(254))
};

export const OidcSetupRequestSchema = z
  .object({ setupToken, ...oidcSetupFields })
  .meta({ id: 'OidcSetupRequest' });

/** A saved OIDC setup for the pre-filled form (AO-16, AO-26); never the secret. */
export const OidcSetupViewSchema = z
  .object({
    issuer: z.string(),
    clientId: z.string(),
    scopes: z.string(),
    requireVerifiedEmail: z.boolean(),
    adminEmail: z.string(),
    hasClientSecret: z.boolean()
  })
  .meta({ id: 'OidcSetupView' });

/** Field codes of the OIDC setup: the first three on `issuer`, `required` on `clientSecret`. */
export const OIDC_SETUP_FIELD_CODES = [
  'oidc-issuer-unreachable',
  'oidc-issuer-mismatch',
  'oidc-discovery-invalid',
  'required'
] as const;

export type OidcSetupFieldCode = (typeof OIDC_SETUP_FIELD_CODES)[number];

export type OnboardingStatus = z.infer<typeof OnboardingStatusSchema>;
export type SetupTokenRequest = z.infer<typeof SetupTokenRequestSchema>;
export type PasswordSetupRequest = z.infer<typeof PasswordSetupRequestSchema>;
export type OidcSetupRequest = z.infer<typeof OidcSetupRequestSchema>;
export type OidcSetupView = z.infer<typeof OidcSetupViewSchema>;
