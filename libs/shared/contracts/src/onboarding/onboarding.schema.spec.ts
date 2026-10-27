import { z } from 'zod';
import {
  DEFAULT_OIDC_SCOPES,
  OidcSetupRequestSchema,
  OidcSetupViewSchema,
  OnboardingStatusSchema,
  PasswordSetupRequestSchema,
  SetupTokenRequestSchema
} from './onboarding.schema';

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

const oidc = {
  setupToken: 'a-setup-token-of-some-length',
  issuer: 'https://id.example.com',
  clientId: 'front-burner',
  clientSecret: 'a-secret',
  adminEmail: 'alice@example.com'
};

const codeOf = (issue: unknown) => (issue as { params?: { code?: string; }; }).params?.code;

describe('OidcSetupRequestSchema', () => {
  it('refuses an http issuer', () => {
    expect(OidcSetupRequestSchema.safeParse({ ...oidc, issuer: 'http://id.example.com' }).success).toBe(false);
  });

  it('refuses an issuer with a query', () => {
    expect(OidcSetupRequestSchema.safeParse({ ...oidc, issuer: 'https://id.example.com/?a=b' }).success).toBe(false);
    expect(OidcSetupRequestSchema.safeParse({ ...oidc, issuer: 'https://id.example.com/#a' }).success).toBe(false);
  });

  it('defaults the scopes and the flag', () => {
    const parsed = OidcSetupRequestSchema.parse(oidc);
    expect(parsed.scopes).toBe(DEFAULT_OIDC_SCOPES);
    expect(parsed.requireVerifiedEmail).toBe(true);
  });

  it('refuses scopes without openid', () => {
    const result = OidcSetupRequestSchema.safeParse({ ...oidc, scopes: 'email profile openidx' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual([ 'scopes' ]);
    expect(codeOf(result.error?.issues[0])).toBe('missing-openid');
    expect(OidcSetupRequestSchema.safeParse({ ...oidc, scopes: 'email openid' }).success).toBe(true);
  });

  it('does not trim the client secret', () => {
    expect(OidcSetupRequestSchema.parse({ ...oidc, clientSecret: ' s \n' }).clientSecret).toBe(' s \n');
  });

  it('accepts a missing or empty client secret', () => {
    const { clientSecret: _, ...withoutSecret } = oidc;
    expect(OidcSetupRequestSchema.parse(withoutSecret).clientSecret).toBeUndefined();
    expect(OidcSetupRequestSchema.parse({ ...oidc, clientSecret: '' }).clientSecret).toBe('');
  });

  it('trims the admin email', () => {
    expect(OidcSetupRequestSchema.parse({ ...oidc, adminEmail: ' alice@example.com ' }).adminEmail).toBe(
      'alice@example.com'
    );
  });

  it('trims the client ID and refuses a blank one', () => {
    expect(OidcSetupRequestSchema.parse({ ...oidc, clientId: ' fb ' }).clientId).toBe('fb');
    expect(OidcSetupRequestSchema.safeParse({ ...oidc, clientId: '  ' }).success).toBe(false);
  });
});

describe('OidcSetupViewSchema', () => {
  it('has no client secret', () => {
    const view = {
      issuer: 'https://id.example.com',
      clientId: 'fb',
      scopes: DEFAULT_OIDC_SCOPES,
      requireVerifiedEmail: true,
      adminEmail: 'alice@example.com',
      hasClientSecret: true
    };
    expect(OidcSetupViewSchema.parse({ ...view, clientSecret: 'x' })).toEqual(view);
  });
});

describe('registry', () => {
  it.each(
    [
      [ OnboardingStatusSchema, 'OnboardingStatus' ],
      [ SetupTokenRequestSchema, 'SetupTokenRequest' ],
      [ PasswordSetupRequestSchema, 'PasswordSetupRequest' ],
      [ OidcSetupRequestSchema, 'OidcSetupRequest' ],
      [ OidcSetupViewSchema, 'OidcSetupView' ]
    ] as const
  )('registers %#', (schema, id) => {
    expect(z.globalRegistry.get(schema as z.ZodType)?.id).toBe(id);
  });
});
