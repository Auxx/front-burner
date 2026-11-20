/** How many segments of an API path that no route answered stay, such as `/api/v1/repositories`. */
const UNMATCHED_API_SEGMENTS = 3;

/** Placeholder for the segments a URL loses. */
const CUT = '/…';

/** The first `count` segments of a path, followed by `/…` when it has more. */
function firstSegments(path: string, count: number): string {
  const segments = path.split('/').slice(1);
  const kept = segments.slice(0, count);
  return segments.slice(count).some(segment => segment !== '') ? `/${kept.join('/')}${CUT}` : path;
}

/**
 * A URL as the log shows it above `debug` (NF-10.5): without the query string,
 * which carries file paths (`?path=…`), OIDC's `code` and `state`, and without
 * any part of the path that may name a file:
 *
 * - an API path that a route answered (`matchedRoute`) stays whole, since
 *   routes hold only fixed words and IDs;
 * - an API path that no route answered, such as an old client's or a made-up
 *   one, keeps its first three segments (`/api/v1/repositories/…`);
 * - any other path is the web client's, whose routes end in a file's path
 *   (`/repositories/1/files/notes/a.md`), or somewhere a redirect leads: only
 *   its first segment stays.
 *
 * A full URL (a request in absolute form, or a redirect's `Location`) keeps its
 * origin, and its path is cut the same way.
 */
export function urlForLog(url: string, matchedRoute = false): string {
  if (!url.startsWith('/')) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return CUT;
    }
    const origin = parsed.origin === 'null' ? '' : parsed.origin;
    return `${origin}${urlForLog(parsed.pathname, matchedRoute)}`;
  }
  const path = url.split(/[?#]/, 1)[0];
  const lower = path.toLowerCase();
  if (lower === '/api' || lower.startsWith('/api/')) {
    return matchedRoute ? path : firstSegments(path, UNMATCHED_API_SEGMENTS);
  }
  return firstSegments(path, 1);
}
