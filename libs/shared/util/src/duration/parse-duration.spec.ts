import { parseDuration } from './parse-duration';

describe('parseDuration', () => {
  it('parses every unit', () => {
    expect(parseDuration('30s')).toBe(30_000);
    expect(parseDuration('15m')).toBe(900_000);
    expect(parseDuration('12h')).toBe(43_200_000);
    expect(parseDuration('30d')).toBe(2_592_000_000);
  });

  it('refuses anything else', () => {
    for (const text of [ '', '15', '15 m', '1.5h', '0m', '15M', '-1d', '1w' ]) {
      expect(parseDuration(text)).toBeUndefined();
    }
  });
});
