/** The properties in which Node's file system errors name their files. */
const PATH_PROPERTIES = [ 'path', 'dest' ] as const;

const HIDDEN = '<path>';

/**
 * `error` without the paths that a file system error names, in its message,
 * its stack and its `path` and `dest` (NF-10.5: paths only at `debug`). Its
 * code and system call stay, which is what tells the operator what failed.
 * Any other error comes back as it is.
 */
export function withoutPaths(error: Error): Error {
  const record = error as Error & Partial<Record<(typeof PATH_PROPERTIES)[number], unknown>>;
  const paths = PATH_PROPERTIES.map(name => record[name])
    .filter((value): value is string => typeof value === 'string' && value !== '');
  if (paths.length === 0) {
    return error;
  }
  const hide = (text: string) => paths.reduce((result, path) => result.split(path).join(HIDDEN), text);
  const copy = new Error(hide(error.message));
  copy.name = error.name;
  copy.stack = error.stack === undefined ? undefined : hide(error.stack);
  for (const [ key, value ] of Object.entries(error)) {
    if (!(PATH_PROPERTIES as readonly string[]).includes(key)) {
      Object.assign(copy, { [key]: value });
    }
  }
  return copy;
}

/**
 * An error as a log entry at `info` or above may show it (NF-10.5): as
 * `String(error)` does, without the paths of a file system error.
 */
export function errorForLog(error: unknown): string {
  return error instanceof Error ? String(withoutPaths(error)) : String(error);
}
