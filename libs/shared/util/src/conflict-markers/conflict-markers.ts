/**
 * Whether the text has a line that looks like a conflict marker (GC-14): one that
 * starts with `<<<<<<< ` or `>>>>>>> `, or is exactly `=======`. Lines end at a
 * line feed, and a carriage return before it does not count, so CRLF files are
 * read alike. Not a regular expression: its `^` also starts a line after a lone
 * `\r` or U+2028.
 */
export function hasConflictMarkers(text: string): boolean {
  return text.split('\n').some(raw => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    return line.startsWith('<<<<<<< ') || line.startsWith('>>>>>>> ') || line === '=======';
  });
}
