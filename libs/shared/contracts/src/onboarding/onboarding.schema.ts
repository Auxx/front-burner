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

export type OnboardingStatus = z.infer<typeof OnboardingStatusSchema>;
export type SetupTokenRequest = z.infer<typeof SetupTokenRequestSchema>;
export type PasswordSetupRequest = z.infer<typeof PasswordSetupRequestSchema>;
