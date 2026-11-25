import type { ApiError } from '@front-burner/shared-contracts';
import { Logger } from '@nestjs/common';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, posix, relative, sep } from 'node:path';
import { contentSecurityPolicy, createNonce, CSP_NONCE_PLACEHOLDER } from '../csp/csp';
import { type ChunkMap, loadChunkMap, preloadTags } from './preloads';

/**
 * A file asked for with the instance's version, such as `assets/icons.svg?v=1.4.2`:
 * that URL's content never changes, since an upgrade changes the URL.
 */
export const VERSIONED_CACHE_CONTROL = 'public, max-age=31536000, immutable';

export interface ServeWebClientOptions {
  /**
   * The instance's version. A file asked for with `?v=` and this version is
   * cached for good (`VERSIONED_CACHE_CONTROL`), so that the browser needs no
   * network for it, also while offline (A-7.9); any other request is
   * revalidated as usual.
   */
  version?: string;
  /** Where a problem with the chunk map is reported, once at startup; by default the log, at `warn`. */
  warn?: (message: string) => void;
}

/**
 * `index.html` for the page at `path`: the template with the page's preloads
 * before `</head>` (A-7.9), when there is a chunk map, and `nonce` in every
 * tag (NF-11.1).
 */
function indexHtml(template: string, chunkMap: ChunkMap | undefined, path: string, nonce: string): string {
  const filled = template.split(CSP_NONCE_PLACEHOLDER).join(nonce);
  const head = filled.indexOf('</head>');
  if (chunkMap === undefined || head < 0) {
    return filled;
  }
  return filled.slice(0, head) + preloadTags(chunkMap, path, nonce) + filled.slice(head);
}

function isApiPath(path: string): boolean {
  // Express routing ignores case, so the check does too.
  const lower = path.toLowerCase();
  return lower === '/api' || lower.startsWith('/api/');
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
 * root (`assets/`, `i18n/`, `media/`; the folder itself too), or a single root-level name with an
 * extension (a hashed chunk). Routes such as `/repositories/1/files/a.md` end in
 * a file name too, so the extension alone cannot tell them apart.
 */
function isMissingBuildFile(path: string, webRoot: string): boolean {
  if (isIndexPath(path)) {
    return false;
  }
  const segments = path.split('/').filter(segment => segment !== '');
  if (segments.length === 1 && extname(segments[0]) !== '') {
    return true;
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

/** The precompressed variants of a file, by `Content-Encoding`, best first. */
const ENCODINGS = [ { encoding: 'br', ext: '.br' }, { encoding: 'gzip', ext: '.gz' } ] as const;

type Encoding = (typeof ENCODINGS)[number]['encoding'];

/**
 * The files of `webRoot` (relative, with `/`) that the build precompressed,
 * with the encodings of their variants. Dot-files are left out, as
 * `express.static` does not serve them.
 */
function findVariants(webRoot: string): Map<string, Set<Encoding>> {
  const variants = new Map<string, Set<Encoding>>();
  const entries = readdirSync(webRoot, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    const variant = ENCODINGS.find(({ ext }) => entry.name.endsWith(ext));
    if (!entry.isFile() || !variant) {
      continue;
    }
    const file = relative(webRoot, join(entry.parentPath, entry.name)).split(sep).join('/').slice(
      0,
      -variant.ext.length
    );
    if (file.split('/').some(segment => segment.startsWith('.')) || !existsSync(join(webRoot, file))) {
      continue;
    }
    const encodings = variants.get(file) ?? new Set<Encoding>();
    encodings.add(variant.encoding);
    variants.set(file, encodings);
  }
  return variants;
}

/** The path of the request relative to the web root, with `/`, or `undefined` when it cannot be decoded. */
function relativePathOf(path: string): string | undefined {
  try {
    return posix.normalize(decodeURIComponent(path)).replace(/^\/+/, '');
  } catch {
    return undefined;
  }
}

/**
 * The best of `available` that `Accept-Encoding` allows: the highest `q`, `br`
 * before `gzip` at the same `q`; `q=0` refuses an encoding, `*` stands for any
 * encoding not named. `undefined` sends the file as it is.
 */
function pickEncoding(
  acceptEncoding: string | undefined,
  available: ReadonlySet<Encoding>
): (typeof ENCODINGS)[number] | undefined {
  const weights = new Map<string, number>();
  for (const part of (acceptEncoding ?? '').split(',')) {
    const [ name, ...params ] = part.split(';').map(item => item.trim().toLowerCase());
    if (!name) {
      continue;
    }
    const q = params.map(param => /^q=([0-9.]+)$/.exec(param)?.[1]).find(value => value !== undefined);
    const weight = q === undefined ? 1 : Number(q);
    weights.set(name, Number.isFinite(weight) ? weight : 0);
  }
  let best: { variant: (typeof ENCODINGS)[number]; weight: number; } | undefined;
  for (const variant of ENCODINGS) {
    const weight = weights.get(variant.encoding) ?? weights.get('*') ?? 0;
    if (available.has(variant.encoding) && weight > 0 && (!best || weight > best.weight)) {
      best = { variant, weight };
    }
  }
  return best?.variant;
}

/** A content hash before the extension, as Angular writes it: `main-AB12cd_-.js` (as in `precompress.mjs`). */
const HASH = /-[A-Za-z0-9_-]{8}\.[^./]+$/;

/**
 * Whether the build names the file at `file` (relative, with `/`) by its
 * content, so that it can be cached for good: with `outputHashing: "all"`,
 * every root-level `.js` and `.css` file and every file in `media/`, when its
 * name has a hash. Both the place and the name must say so: a development
 * build writes `main.js` without a hash, and the production build's
 * `precompress.mjs` fails when a file in these places has none.
 */
function isHashedFile(file: string): boolean {
  const segments = file.split('/');
  const place = segments.length === 1 ? [ '.js', '.css' ].includes(extname(file)) : segments[0] === 'media';
  return place && HASH.test(segments[segments.length - 1]);
}

/**
 * Serves the built web client from `webRoot` (A-7.9): files as they are, or
 * the precompressed variant the request accepts, and `index.html` with a fresh
 * CSP nonce for every other route, so that the client-side router can handle
 * it, with the preloads of that route's chunks when the build wrote a chunk
 * map. Files the build names by their content are cached for good. Returns
 * `false`, registering nothing, when there is no build.
 */
export function serveWebClient(
  app: express.Application,
  webRoot: string,
  options: ServeWebClientOptions = {}
): boolean {
  const indexPath = join(webRoot, 'index.html');
  if (!existsSync(indexPath)) {
    return false;
  }
  const template = readFileSync(indexPath, 'utf8');
  const variants = findVariants(webRoot);
  const chunkMap = loadChunkMap(webRoot, options.warn ?? (message => new Logger('WebClient').warn(message)));
  const cacheControlOf = (req: express.Request, file: string | undefined): string | undefined => {
    const versioned = options.version !== undefined && req.query['v'] === options.version;
    return versioned || (file !== undefined && isHashedFile(file)) ? VERSIONED_CACHE_CONTROL : undefined;
  };
  const files = express.static(webRoot, {
    index: false,
    redirect: false,
    setHeaders: (res: express.Response) => {
      const cacheControl = cacheControlOf(res.req, relativePathOf(res.req.path));
      if (cacheControl) {
        res.setHeader('Cache-Control', cacheControl);
      }
    }
  });
  const sendNotFound = (res: express.Response): void => {
    const requestId = (res.getHeader('X-Request-Id') as string | undefined) ?? randomUUID();
    const body: ApiError = { code: 'not-found', params: {}, requestId, message: 'Not found.' };
    res.status(404).set('X-Request-Id', requestId).json(body);
  };

  /** The file as it is, or `index.html` with a fresh nonce, or 404 for a missing file of the build. */
  const serveFileOrIndex = (req: express.Request, res: express.Response, next: express.NextFunction): void => {
    // index.html is a template: it must only leave through the nonce branch.
    const serveFile: express.RequestHandler = isIndexPath(req.path) ? (_req, _res, done) => done() : files;
    serveFile(req, res, err => {
      if (err) {
        next(err);
        return;
      }
      if (isMissingBuildFile(req.path, webRoot)) {
        sendNotFound(res);
        return;
      }
      const nonce = createNonce();
      res
        .status(200)
        .type('text/html; charset=utf-8')
        .set('Cache-Control', 'no-store')
        .set('Content-Security-Policy', contentSecurityPolicy(nonce))
        .send(indexHtml(template, chunkMap, req.path, nonce));
    });
  };

  app.use((req, res, next) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || isApiPath(req.path)) {
      next();
      return;
    }
    const file = relativePathOf(req.path);
    if (file !== undefined) {
      // A variant is only sent in place of its file: no second URL with the wrong type.
      const variantOf = ENCODINGS.find(({ ext }) => file.endsWith(ext) && variants.has(file.slice(0, -ext.length)));
      if (variantOf) {
        sendNotFound(res);
        return;
      }
      const available = isIndexPath(req.path) ? undefined : variants.get(file);
      if (available) {
        res.vary('Accept-Encoding');
        const variant = pickEncoding(req.get('Accept-Encoding'), available);
        if (variant) {
          const { encoding, ext } = variant;
          res.type(extname(file)).set('Content-Encoding', encoding);
          const cacheControl = cacheControlOf(req, file);
          if (cacheControl) {
            res.set('Cache-Control', cacheControl);
          }
          // A range of compressed bytes is a trap, and nothing in the web client asks for one.
          res.sendFile(join(webRoot, file + ext), { acceptRanges: false, dotfiles: 'ignore' }, err => {
            // The variant went missing or cannot be read since startup: the file as it is will do.
            if (err && !res.headersSent) {
              for (const header of [ 'Content-Encoding', 'Content-Type', 'Cache-Control' ]) {
                res.removeHeader(header);
              }
              res.status(200);
              serveFileOrIndex(req, res, next);
            }
          });
          return;
        }
      }
    }
    serveFileOrIndex(req, res, next);
  });
  return true;
}
