import compression from 'compression';
import type { Request, RequestHandler, Response } from 'express';
import { constants } from 'node:zlib';

/**
 * The API routes whose answers carry auth tokens. With a secret and something
 * the request chose in the same compressed body, the body's size can leak the
 * secret (BREACH), so they are never compressed (A-7.15).
 */
const UNCOMPRESSED_ROUTES = /^\/api\/v1\/(?:auth|onboarding)(?:\/|$)/;

/** The request's path, decoded and in lower case, as Express routes it; `undefined` when it cannot be decoded. */
function pathOf(req: Request): string | undefined {
  try {
    return decodeURIComponent(req.originalUrl.split('?')[0]).toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Whether an answer may be compressed (A-7.15): only the API's, never the
 * authentication and onboarding answers, never the push channel, whose events
 * would wait in the compressor's buffer (A-3.10), and then what the
 * `compression` filter allows (compressible types). The web client's files
 * are compressed at build and sent by `serveWebClient` (A-7.9).
 */
export function shouldCompress(req: Request, res: Response): boolean {
  const path = pathOf(req);
  if (path === undefined || !path.startsWith('/api/') || UNCOMPRESSED_ROUTES.test(path)) {
    return false;
  }
  const type = String(res.getHeader('Content-Type') ?? '');
  if (/^\s*text\/event-stream\b/i.test(type)) {
    return false;
  }
  return compression.filter(req, res);
}

/**
 * Compresses API answers of 1 KB or more as they are sent (A-7.15): gzip at
 * level 6, or Brotli at quality 4 when the client prefers it, both cheap on
 * the CPU. The encoding is chosen when the headers are written, so
 * `Server-Timing` (A-7.14) leaves out the time to compress and send.
 */
export function compressResponses(): RequestHandler {
  return compression({
    filter: shouldCompress,
    threshold: 1024,
    level: 6,
    brotli: { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } }
  });
}
