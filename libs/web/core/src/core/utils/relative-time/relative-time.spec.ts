import { relativeTime } from './relative-time';

const now = new Date(Date.UTC(2026, 9, 27, 12));
const before = (seconds: number) => new Date(now.getTime() - seconds * 1000);

describe('relativeTime', () => {
  it.each(
    [
      [ 40, '40 seconds ago' ],
      [ 2 * 3600 + 59 * 60, '2 hours ago' ],
      [ 25 * 3600, 'yesterday' ],
      [ 3 * 86_400, '3 days ago' ],
      [ 45 * 86_400, 'last month' ],
      [ 800 * 86_400, '2 years ago' ]
    ] as const
  )('shows %i seconds ago as "%s"', (seconds, text) => {
    expect(relativeTime(before(seconds), now, 'en')).toBe(text);
  });

  it('shows the current moment and a time slightly ahead as now', () => {
    expect(relativeTime(now, now, 'en')).toBe('now');
    expect(relativeTime(new Date(now.getTime() + 2000), now, 'en')).toBe('now');
  });

  it('uses the locale', () => {
    expect(relativeTime(before(3600), now, 'de')).toBe('vor 1 Stunde');
  });
});
