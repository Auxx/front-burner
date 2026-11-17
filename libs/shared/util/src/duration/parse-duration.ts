export const SECOND_MS = 1_000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

const UNIT_MS = { s: SECOND_MS, m: MINUTE_MS, h: HOUR_MS, d: DAY_MS } as const;

/**
 * Reads a duration such as `15m` or `30d`: a positive integer followed by `s`,
 * `m`, `h` or `d` (LG-62).
 *
 * @returns milliseconds, or `undefined` for anything else.
 */
export function parseDuration(text: string): number | undefined {
  const match = /^([1-9]\d*)([smhd])$/.exec(text);
  if (match === null) {
    return undefined;
  }
  return Number(match[1]) * UNIT_MS[match[2] as keyof typeof UNIT_MS];
}
