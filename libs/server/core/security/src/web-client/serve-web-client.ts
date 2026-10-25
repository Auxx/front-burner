import express from 'express';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, posix } from 'node:path';
import { contentSecurityPolicy, createNonce, CSP_NONCE_PLACEHOLDER } from '../csp/csp';

function isApiPath(path: string): boolean {
  return path === '/api' || path.startsWith('/api/');
}

/** Whether the request names index.html, however it is spelled (encoded, `./`, other case). */
function isIndexPath(path: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return false;
  }
  return posix.normalize(decoded).toLowerCase() === '/index.html';
}

/**
 * Whether a path that matched no file is a missing file of the build (answered
 * with 404) rather than a client-side route: anything under a folder of the web
 * root (`assets/`, `i18n/`, `media/`), or a single root-level name with an
 * extension (a hashed chunk). Routes such as `/repositories/1/files/a.md` end in
 * a file name too, so the extension alone cannot tell them apart.
 */
function isMissingBuildFile(path: string, webRoot: string): boolean {
  if (isIndexPath(path)) {
    return false;
  }
  const segments = path.split('/').filter(segment => segment !== '');
  if (segments.length === 1) {
    return extname(segments[0]) !== '';
  }
  let first: string;
  try {
    first = decodeURIComponent(segments[0] ?? '');
  } catch {
    return false;
  }
  if (first === '' || first === '.' || first === '..' || /[\\/]/.test(first)) {
    return false;
  }
  try {
    return statSync(join(webRoot, first)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Serves the built web client from `webRoot` (A-7.9): files as they are, and
 * `index.html` with a fresh CSP nonce for every other route, so that the
 * client-side router can handle it. Returns `false`, registering nothing, when
 * there is no build.
 */
export function serveWebClient(app: express.Application, webRoot: string): boolean {
  const indexPath = join(webRoot, 'index.html');
  if (!existsSync(indexPath)) {
    return false;
  }
  const template = readFileSync(indexPath, 'utf8');
  const files = express.static(webRoot, { index: false });

  app.use((req, res, next) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || isApiPath(req.path)) {
      next();
      return;
    }
    // index.html is a template: it must only leave through the nonce branch.
    const serveFile: express.RequestHandler = isIndexPath(req.path) ? (_req, _res, done) => done() : files;
    serveFile(req, res, err => {
      if (err) {
        next(err);
        return;
      }
      if (isMissingBuildFile(req.path, webRoot)) {
        res.status(404).end();
        return;
      }
      const nonce = createNonce();
      res
        .status(200)
        .type('text/html; charset=utf-8')
        .set('Cache-Control', 'no-store')
        .set('Content-Security-Policy', contentSecurityPolicy(nonce))
        .send(template.split(CSP_NONCE_PLACEHOLDER).join(nonce));
    });
  });
  return true;
}
