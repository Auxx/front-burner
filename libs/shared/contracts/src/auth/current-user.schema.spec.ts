import { CurrentUserSchema } from './current-user.schema';

const ada = { id: 1, email: 'ada@example.com', displayName: 'Ada', role: 'user' } as const;

describe('CurrentUserSchema', () => {
  it('accepts the allowed levels', () => {
    expect(CurrentUserSchema.parse({ ...ada, allowedGitLevels: [ 'simple', 'advanced' ] }).allowedGitLevels)
      .toEqual([ 'simple', 'advanced' ]);
  });

  it('refuses an unknown level', () => {
    expect(CurrentUserSchema.safeParse({ ...ada, allowedGitLevels: [ 'expert' ] }).success).toBe(false);
  });
});
