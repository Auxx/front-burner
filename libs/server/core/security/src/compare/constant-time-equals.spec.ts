import { constantTimeEquals } from './constant-time-equals';

describe('constantTimeEquals', () => {
  it('is true for equal strings', () => {
    expect(constantTimeEquals('a-setup-token-0123', 'a-setup-token-0123')).toBe(true);
  });

  it.each([
    [ 'differs in the last character', 'a-setup-token-0123', 'a-setup-token-0124' ],
    [ 'differs in length', 'a-setup-token-0123', 'a-setup-token-01234' ],
    [ 'is empty against non-empty', '', 'a-setup-token-0123' ],
    [ 'differs only in trailing whitespace', 'a-setup-token-0123', 'a-setup-token-0123\n' ]
  ])('is false when it %s', (_case, a, b) => {
    expect(constantTimeEquals(a, b)).toBe(false);
  });
});
