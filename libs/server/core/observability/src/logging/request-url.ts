/**
 * A request's URL as the log shows it above `debug` (NF-10.5): without the
 * query string, which carries file paths (`?path=…`) and OIDC's `code` and
 * `state`. An API path keeps all of it, since it holds only fixed words and
 * IDs. Any other path is the web client's, whose routes end in a file's path
 * (`/repositories/1/files/notes/a.md`), so only its first segment stays, with
 * `/…` for the rest.
 */
export function urlForLog(url: string): string {
  const path = url.split(/[?#]/, 1)[0];
  const lower = path.toLowerCase();
  if (lower === '/api' || lower.startsWith('/api/')) {
    return path;
  }
  const match = /^\/[^/]*\/./.exec(path);
  return match ? `${match[0].slice(0, -1)}…` : path;
}
