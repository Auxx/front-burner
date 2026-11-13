const BYTES_PER_UNIT = 1024;

/** A size in bytes, in the largest unit that keeps it above 1, such as `1.5 KB`. */
export function formatSize(bytes: number): string {
  if (bytes < BYTES_PER_UNIT) {
    return `${bytes} B`;
  }
  const kilobytes = bytes / BYTES_PER_UNIT;
  const [ value, unit ] = kilobytes < BYTES_PER_UNIT ? [ kilobytes, 'KB' ] : [ kilobytes / BYTES_PER_UNIT, 'MB' ];
  return `${Number(value.toFixed(1))} ${unit}`;
}
