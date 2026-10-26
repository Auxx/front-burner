// eslint-disable-next-line no-control-regex -- control characters are what it looks for.
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

/**
 * A return target for after the login, or the home page (LG-4). Only a path
 * inside the web client is kept: it starts with one `/` that a second `/` or a
 * `\` does not turn into another host, and it has no control characters, which
 * browsers strip before reading the URL.
 */
export function safeReturnUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || CONTROL_CHARACTER.test(value)) {
    return '/';
  }
  return value[1] === '/' || value[1] === '\\' ? '/' : value;
}
