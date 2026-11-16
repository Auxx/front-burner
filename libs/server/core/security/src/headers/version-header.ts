import type { RequestHandler } from 'express';

/** The response header that carries the instance's version (NF-7.6, A-8.7). */
export const VERSION_HEADER = 'X-Front-Burner-Version';

/** The health probes reveal no version (NF-10.9). */
const HEALTH_PATH = /^\/api\/health(\/|$)/;

/**
 * Sets the instance's version on every response but the health probes': the
 * API's, errors included, and `index.html` (A-7.9). A tab left open across an
 * upgrade compares it with its own (A-8.7). Mount it before anything that can
 * answer, so that no response leaves without it.
 */
export function versionHeader(version: string): RequestHandler {
  return (req, res, next) => {
    if (!HEALTH_PATH.test(req.path)) {
      res.setHeader(VERSION_HEADER, version);
    }
    next();
  };
}
