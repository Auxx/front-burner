import { isRepositoryId } from './is-repository-id';

describe('isRepositoryId', () => {
  it('accepts a positive integer without leading zeros', () => {
    expect(isRepositoryId('1')).toBe(true);
    expect(isRepositoryId('42')).toBe(true);
  });

  it('refuses anything else', () => {
    for (const segment of [ '', '0', '07', '-1', '1.5', 'abc', '1e3', ' 1', '99999999999999999999' ]) {
      expect(isRepositoryId(segment)).toBe(false);
    }
  });
});
