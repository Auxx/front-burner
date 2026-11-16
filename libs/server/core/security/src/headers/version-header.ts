import type { RequestHandler } from 'express';

/** The response header that carries the instance's version (NF-7.6, A-8.7). */
export const VERSION_HEADER = 'X-Front-Burner-Version';

export interface VersionHeaderOptions {
  /** Routes that never get the header, such as the health probes (NF-10.9), without leading slash. */
  except: readonly string[];
}

/** A path as the router matches it: case-insensitive, with or without a slash at either end. */
function routeOf(path: string): string {
  return path.replace(/^\/|\/$/g, '').toLowerCase();
}

/**
 * Sets the instance's version on every response but those of `except`: the
 * API's, errors included, and `index.html` (A-7.9). A tab left open across an
 * upgrade compares it with its own (A-8.7). Mount it before anything that can
 * answer, so that no response leaves without it.
 */
export function versionHeader(version: string, options: VersionHeaderOptions): RequestHandler {
  const except = new Set(options.except.map(routeOf));
  return (req, res, next) => {
    if (!except.has(routeOf(req.path))) {
      res.setHeader(VERSION_HEADER, version);
    }
    next();
  };
}
