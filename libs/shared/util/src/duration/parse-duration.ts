const UNIT_MS = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

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
