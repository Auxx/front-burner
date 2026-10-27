const UNITS: readonly (readonly [ Intl.RelativeTimeFormatUnit, number ])[] = [
  [ 'year', 365 * 86_400 ],
  [ 'month', 30 * 86_400 ],
  [ 'day', 86_400 ],
  [ 'hour', 3600 ],
  [ 'minute', 60 ],
  [ 'second', 1 ]
];

/**
 * How long ago `date` was, in the largest unit that fits, rounded down: "40
 * seconds ago", "2 hours ago", "yesterday" (DS-18). A time slightly ahead of
 * `now`, from a clock that differs from the server's, reads as now.
 */
export function relativeTime(date: Date, now: Date, locale: string): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const [ unit, size ] = UNITS.find(([ , size ]) => seconds >= size) ?? [ 'second', 1 ];
  return format.format(-Math.floor(seconds / size), unit);
}
