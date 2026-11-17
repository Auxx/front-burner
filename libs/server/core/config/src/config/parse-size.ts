const UNIT_BYTES = { KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 } as const;

/**
 * Reads a size variable as bytes: a whole number of bytes, or a number
 * followed by `KB`, `MB` or `GB`, 1024-based and in any case, such as `2GB` or
 * `1.5MB` (A-1.15). A fraction of a byte is dropped.
 *
 * @returns undefined for anything else, such as a space, a sign or another unit.
 */
export function parseSize(value: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)(KB|MB|GB)?$/i.exec(value);
  if (match === null) {
    return undefined;
  }
  const [ , amount, unit ] = match;
  if (unit === undefined) {
    return /^\d+$/.test(amount) ? Number(amount) : undefined;
  }
  return Math.floor(Number(amount) * UNIT_BYTES[unit.toUpperCase() as keyof typeof UNIT_BYTES]);
}
