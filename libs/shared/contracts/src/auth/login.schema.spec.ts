import { z } from 'zod';
import { CurrentUserSchema } from './current-user.schema';
import { LoginMethodsSchema, LoginRequestSchema, RefreshRequestSchema, SessionTokensSchema } from './login.schema';

describe('LoginRequestSchema', () => {
  it('trims the email but not the password', () => {
    expect(LoginRequestSchema.parse({ email: ' A@b.co ', password: ' x ' })).toEqual({
      email: 'A@b.co',
      password: ' x ',
      refreshTokenDelivery: 'cookie'
    });
  });

  it('defaults to cookie delivery', () => {
    expect(LoginRequestSchema.parse({ email: 'a@b.co', password: 'x' }).refreshTokenDelivery).toBe('cookie');
  });

  it('refuses an unknown delivery', () => {
    expect(LoginRequestSchema.safeParse({ email: 'a@b.co', password: 'x', refreshTokenDelivery: 'url' }).success)
      .toBe(false);
  });

  it('applies no password policy', () => {
    expect(LoginRequestSchema.safeParse({ email: 'a@b.co', password: 'a' }).success).toBe(true);
    expect(LoginRequestSchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false);
  });
});

describe('registry', () => {
  it.each(
    [
      [ LoginRequestSchema, 'LoginRequest' ],
      [ SessionTokensSchema, 'SessionTokens' ],
      [ RefreshRequestSchema, 'RefreshRequest' ],
      [ LoginMethodsSchema, 'LoginMethods' ],
      [ CurrentUserSchema, 'CurrentUser' ]
    ] as const
  )('registers %#', (schema, id) => {
    expect(z.globalRegistry.get(schema as z.ZodType)?.id).toBe(id);
  });
});
