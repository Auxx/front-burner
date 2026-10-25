import { z } from 'zod';
import { OnboardingStatusSchema, PasswordSetupRequestSchema, SetupTokenRequestSchema } from './onboarding.schema';

const valid = {
  setupToken: 'a-setup-token-of-some-length',
  email: 'alice@example.com',
  displayName: 'Alice',
  password: 'abcdefghi1'
};

describe('OnboardingStatusSchema', () => {
  it('parses a status', () => {
    const status = { state: 'required', oidcFromEnvironment: false, setupTokenConfigured: true };
    expect(OnboardingStatusSchema.parse(status)).toEqual(status);
  });

  it('refuses an unknown state', () => {
    expect(
      OnboardingStatusSchema.safeParse({ state: 'open', oidcFromEnvironment: false, setupTokenConfigured: true })
        .success
    ).toBe(false);
  });
});

describe('SetupTokenRequestSchema', () => {
  it('does not trim the setup token', () => {
    expect(SetupTokenRequestSchema.parse({ setupToken: ' token\n' })).toEqual({ setupToken: ' token\n' });
  });

  it('refuses an empty token', () => {
    expect(SetupTokenRequestSchema.safeParse({ setupToken: '' }).success).toBe(false);
  });
});

describe('PasswordSetupRequestSchema', () => {
  it('parses a valid request', () => {
    expect(PasswordSetupRequestSchema.parse(valid)).toEqual(valid);
  });

  it('trims the email', () => {
    expect(PasswordSetupRequestSchema.parse({ ...valid, email: ' alice@example.com ' }).email).toBe(
      'alice@example.com'
    );
  });

  it('trims the display name and refuses a blank one', () => {
    expect(PasswordSetupRequestSchema.parse({ ...valid, displayName: ' Alice ' }).displayName).toBe('Alice');
    expect(PasswordSetupRequestSchema.safeParse({ ...valid, displayName: '   ' }).success).toBe(false);
  });

  it('refuses an invalid email', () => {
    expect(PasswordSetupRequestSchema.safeParse({ ...valid, email: 'alice' }).success).toBe(false);
  });

  it('refuses a password equal to the email in another case', () => {
    const result = PasswordSetupRequestSchema.safeParse({ ...valid, password: 'ALICE@example.com' });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toHaveLength(1);
    expect(result.error?.issues[0]?.path).toEqual([ 'password' ]);
    expect((result.error?.issues[0] as { params?: { code?: string; }; }).params?.code).toBe('equals-email');
  });

  it('reports the policy even when the email is invalid', () => {
    const result = PasswordSetupRequestSchema.safeParse({ ...valid, email: 'alice', password: 'abc' });
    const codes = result.error?.issues
      .filter(issue => issue.path[0] === 'password')
      .map(issue => (issue as { params?: { code?: string; }; }).params?.code);
    expect(codes).toEqual([ 'too-short', 'too-few-classes' ]);
  });
});

describe('registry', () => {
  it.each(
    [
      [ OnboardingStatusSchema, 'OnboardingStatus' ],
      [ SetupTokenRequestSchema, 'SetupTokenRequest' ],
      [ PasswordSetupRequestSchema, 'PasswordSetupRequest' ]
    ] as const
  )('registers %#', (schema, id) => {
    expect(z.globalRegistry.get(schema as z.ZodType)?.id).toBe(id);
  });
});
