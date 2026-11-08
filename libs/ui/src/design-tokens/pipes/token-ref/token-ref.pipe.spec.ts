import { TokenRefPipe } from './token-ref.pipe';

describe('TokenRefPipe', () => {
  it('refers to the token\'s custom property', () => {
    expect(new TokenRefPipe().transform('text-default')).toBe('var(--ui-text-default)');
  });
});
