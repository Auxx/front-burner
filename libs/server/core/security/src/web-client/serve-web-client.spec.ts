import express from 'express';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import request from 'supertest';
import { contentSecurityPolicy } from '../csp/csp';
import { serveWebClient, VERSIONED_CACHE_CONTROL } from './serve-web-client';

const INDEX = '<html><body><app-root ngCspNonce="__CSP_NONCE__"></app-root></body></html>';

describe('serveWebClient', () => {
  /** The build's folder: `browser/` (the web root) and the chunk map next to it, as `dist/apps/web` holds them. */
  let dist: string;
  let webRoot: string;

  beforeEach(() => {
    dist = mkdtempSync(join(tmpdir(), 'fb-web-'));
    webRoot = join(dist, 'browser');
    mkdirSync(webRoot);
  });

  afterEach(() => {
    rmSync(dist, { recursive: true, force: true });
  });

  function createApp(): express.Application {
    writeFileSync(join(webRoot, 'index.html'), INDEX);
    writeFileSync(join(webRoot, 'main.js'), 'console.log(1);');
    const app = express();
    expect(serveWebClient(app, webRoot)).toBe(true);
    app.use((_req, res) => {
      res.status(418).send('next');
    });
    return app;
  }

  function nonceOf(body: string): string {
    const match = /ngCspNonce="([^"]+)"/.exec(body);
    if (!match) {
      throw new Error('no nonce in the body');
    }
    return match[1];
  }

  it('serves index.html for a route', async () => {
    const res = await request(createApp()).get('/login');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).not.toContain('__CSP_NONCE__');
    const nonce = nonceOf(res.text);
    expect(res.headers['content-security-policy']).toBe(contentSecurityPolicy(nonce));
    expect(res.headers['content-security-policy']).toContain(`'nonce-${nonce}'`);
  });

  it('serves index.html for the root and answers HEAD', async () => {
    const app = createApp();
    expect((await request(app).get('/')).status).toBe(200);
    expect((await request(app).head('/some/deep/route')).status).toBe(200);
  });

  it('NF-11.1: uses a new nonce per request', async () => {
    const app = createApp();
    const first = await request(app).get('/login');
    const second = await request(app).get('/login');
    expect(nonceOf(first.text)).not.toBe(nonceOf(second.text));
  });

  it('serves an existing file', async () => {
    const res = await request(createApp()).get('/main.js');
    expect(res.status).toBe(200);
    expect(res.text).toBe('console.log(1);');
  });

  describe('a file asked for with a version', () => {
    function versionedApp(): express.Application {
      mkdirSync(join(webRoot, 'assets'));
      writeFileSync(join(webRoot, 'assets', 'icons.svg'), '<svg></svg>');
      writeFileSync(join(webRoot, 'index.html'), INDEX);
      const app = express();
      serveWebClient(app, webRoot, { version: '1.4.2' });
      return app;
    }

    it('is cached for good with the instance\'s version, so that it is there offline', async () => {
      const res = await request(versionedApp()).get('/assets/icons.svg?v=1.4.2');
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe(VERSIONED_CACHE_CONTROL);
    });

    it.each([ '/assets/icons.svg', '/assets/icons.svg?v=1.4.1' ])('is revalidated as %s', async path => {
      const res = await request(versionedApp()).get(path);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('public, max-age=0');
    });
  });

  it('serves an existing file in a folder', async () => {
    mkdirSync(join(webRoot, 'assets'));
    writeFileSync(join(webRoot, 'assets', 'a.txt'), 'hello');
    const res = await request(createApp()).get('/assets/a.txt');
    expect(res.status).toBe(200);
    expect(res.text).toBe('hello');
  });

  it.each([ '/index.html', '/%69ndex.html', '/./index.html', '/INDEX.HTML' ])(
    'NF-11.1: templates %s like any route',
    async path => {
      const res = await request(createApp()).get(path);
      expect(res.status).toBe(200);
      expect(res.text).not.toContain('__CSP_NONCE__');
      expect(res.headers['content-security-policy']).toBe(contentSecurityPolicy(nonceOf(res.text)));
      expect(res.headers['cache-control']).toBe('no-store');
    }
  );

  it('sends the CSP header for HEAD /index.html', async () => {
    const res = await request(createApp()).head('/index.html');
    expect(res.status).toBe(200);
    expect(res.headers['content-security-policy']).toContain('\'nonce-');
  });

  it.each([ '/..%2fsecret.txt', '/%2e%2e/secret.txt', '/.secret', '/..%2f..%2fetc/passwd' ])(
    'does not disclose files outside the web root or dot-files via %s',
    async path => {
      const outside = join(webRoot, '..', 'secret.txt');
      writeFileSync(outside, 'TOP-SECRET');
      writeFileSync(join(webRoot, '.secret'), 'TOP-SECRET');
      try {
        const res = await request(createApp()).get(path);
        expect(res.text).not.toContain('TOP-SECRET');
        expect([ 200, 400, 404 ]).toContain(res.status);
      } finally {
        rmSync(outside, { force: true });
      }
    }
  );

  it('returns 404 for a missing file in a folder of the build', async () => {
    mkdirSync(join(webRoot, 'assets'));
    const res = await request(createApp()).get('/assets/missing.png');
    expect(res.status).toBe(404);
  });

  it('answers a build directory without a trailing slash with 404, not a redirect', async () => {
    mkdirSync(join(webRoot, 'assets'));
    const res = await request(createApp()).get('/assets');
    expect(res.status).toBe(404);
    expect(res.headers['location']).toBeUndefined();
  });

  it('answers a missing build file with the JSON ApiError body and the request ID', async () => {
    mkdirSync(join(webRoot, 'assets'));
    const app = createApp();
    const res = await request(app).get('/assets/missing.png').set('Accept', 'image/png');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body).toEqual({
      code: 'not-found',
      params: {},
      requestId: res.headers['x-request-id'],
      message: 'Not found.'
    });
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('reuses the request ID that is already set', async () => {
    writeFileSync(join(webRoot, 'index.html'), INDEX);
    const app = express();
    app.use((_req, res, next) => {
      res.setHeader('X-Request-Id', 'abc-123');
      next();
    });
    serveWebClient(app, webRoot);
    const res = await request(app).get('/missing-chunk.js');
    expect(res.body.requestId).toBe('abc-123');
  });

  it('returns 404 for a missing file at the root, such as a hashed chunk', async () => {
    const res = await request(createApp()).get('/missing-chunk.js');
    expect(res.status).toBe(404);
  });

  it('serves index.html for a deep link that ends in a file name', async () => {
    mkdirSync(join(webRoot, 'assets'));
    const res = await request(createApp()).get('/repositories/1/files/docs/README.md');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('__CSP_NONCE__');
    expect(res.headers['content-security-policy']).toBe(contentSecurityPolicy(nonceOf(res.text)));
  });

  it('serves index.html for a deep link when the first segment is a file name', async () => {
    expect((await request(createApp()).get('/main.js/x.md')).status).toBe(200);
  });

  it('leaves /api paths alone', async () => {
    const app = createApp();
    expect((await request(app).get('/api/v1/x')).status).toBe(418);
    expect((await request(app).get('/api')).status).toBe(418);
    expect((await request(app).get('/API/v1/x')).status).toBe(418);
    expect((await request(app).get('/Api')).status).toBe(418);
  });

  it('does not treat /apiary as an API path', async () => {
    expect((await request(createApp()).get('/apiary')).status).toBe(200);
  });

  it('leaves other methods alone', async () => {
    expect((await request(createApp()).post('/login')).status).toBe(418);
  });

  it('does nothing without a build', () => {
    const app = express();
    expect(serveWebClient(app, webRoot)).toBe(false);
  });

  describe('precompressed variants', () => {
    const JS = 'console.log("main");'.repeat(100);
    const BR = brotliCompressSync(JS);
    const GZ = gzipSync(JS);
    const JS_TYPE = 'text/javascript; charset=utf-8';

    function compressedApp(): express.Application {
      writeFileSync(join(webRoot, 'index.html'), INDEX);
      writeFileSync(join(webRoot, 'index.html.gz'), gzipSync(INDEX));
      writeFileSync(join(webRoot, 'main-ABCD1234.js'), JS);
      writeFileSync(join(webRoot, 'main-ABCD1234.js.br'), BR);
      writeFileSync(join(webRoot, 'main-ABCD1234.js.gz'), GZ);
      writeFileSync(join(webRoot, 'chunk-PLAIN123.js'), 'plain');
      const app = express();
      serveWebClient(app, webRoot, { version: '1.4.2' });
      return app;
    }

    // supertest decodes the body; Content-Length shows which file was sent.

    it('NF-2.7: sends main-X.js as Brotli to a client that accepts br, with its JavaScript type and Vary', async () => {
      const res = await request(compressedApp()).get('/main-ABCD1234.js').set('Accept-Encoding', 'gzip, br');
      expect(res.status).toBe(200);
      expect(res.headers['content-encoding']).toBe('br');
      expect(res.headers['content-type']).toBe(JS_TYPE);
      expect(res.headers['vary']).toBe('Accept-Encoding');
      expect(res.headers['content-length']).toBe(String(BR.length));
      expect(res.text).toBe(JS);
    });

    it.each([ 'gzip', 'gzip, deflate', 'br;q=0, gzip', 'br;q=0.5, gzip', 'BR;q=0, *' ])(
      'sends gzip when br is not accepted, or has q=0 or a lower q (%s)',
      async acceptEncoding => {
        const res = await request(compressedApp()).get('/main-ABCD1234.js').set('Accept-Encoding', acceptEncoding);
        expect(res.headers['content-encoding']).toBe('gzip');
        expect(res.headers['content-type']).toBe(JS_TYPE);
        expect(res.headers['vary']).toBe('Accept-Encoding');
        expect(res.headers['content-length']).toBe(String(GZ.length));
        expect(res.text).toBe(JS);
      }
    );

    it.each([ 'identity', 'deflate', 'br;q=0, gzip;q=0', '*;q=0' ])(
      'sends the file as it is to a client that accepts neither, with Vary (%s)',
      async acceptEncoding => {
        const res = await request(compressedApp()).get('/main-ABCD1234.js').set('Accept-Encoding', acceptEncoding);
        expect(res.headers['content-encoding']).toBeUndefined();
        expect(res.headers['content-type']).toBe(JS_TYPE);
        expect(res.headers['vary']).toBe('Accept-Encoding');
        expect(res.text).toBe(JS);
      }
    );

    it('sends the file as it is when there is no variant', async () => {
      const res = await request(compressedApp()).get('/chunk-PLAIN123.js').set('Accept-Encoding', 'gzip, br');
      expect(res.headers['content-encoding']).toBeUndefined();
      expect(res.headers['vary']).toBeUndefined();
      expect(res.text).toBe('plain');
    });

    it('answers HEAD like GET without a body', async () => {
      const res = await request(compressedApp()).head('/main-ABCD1234.js').set('Accept-Encoding', 'br');
      expect(res.status).toBe(200);
      expect(res.headers['content-encoding']).toBe('br');
      expect(res.headers['content-type']).toBe(JS_TYPE);
      expect(res.headers['content-length']).toBe(String(BR.length));
      expect(res.body).toEqual({});
    });

    it('does not take a Range request for a compressed answer', async () => {
      const res = await request(compressedApp())
        .get('/main-ABCD1234.js')
        .set('Accept-Encoding', 'br')
        .set('Range', 'bytes=0-9');
      expect(res.status).toBe(200);
      expect(res.headers['accept-ranges']).toBeUndefined();
      expect(res.headers['content-range']).toBeUndefined();
      expect(res.headers['content-length']).toBe(String(BR.length));
      expect(res.text).toBe(JS);
    });

    it('answers a conditional request with 304', async () => {
      const app = compressedApp();
      const first = await request(app).get('/main-ABCD1234.js').set('Accept-Encoding', 'br');
      const res = await request(app)
        .get('/main-ABCD1234.js')
        .set('Accept-Encoding', 'br')
        .set('If-None-Match', first.headers['etag']);
      expect(res.status).toBe(304);
    });

    it('sends the file as it is when its variant has gone since startup', async () => {
      const app = compressedApp();
      rmSync(join(webRoot, 'main-ABCD1234.js.br'));
      const res = await request(app).get('/main-ABCD1234.js').set('Accept-Encoding', 'br');
      expect(res.status).toBe(200);
      expect(res.headers['content-encoding']).toBeUndefined();
      expect(res.headers['content-type']).toBe(JS_TYPE);
      expect(res.headers['content-length']).toBe(String(JS.length));
      expect(res.headers['cache-control']).toBe(VERSIONED_CACHE_CONTROL);
      expect(res.text).toBe(JS);
    });

    it.each([ '/main-ABCD1234.js.br', '/main-ABCD1234.js.gz', '/main-ABCD1234.js%2Ebr' ])(
      'answers 404 for %s by its own name',
      async path => {
        const res = await request(compressedApp()).get(path).set('Accept-Encoding', 'gzip, br');
        expect(res.status).toBe(404);
        expect(res.headers['content-type']).toMatch(/^application\/json/);
      }
    );

    it('still sends index.html with a fresh nonce and no-store, never compressed by this handler', async () => {
      const app = compressedApp();
      for (const path of [ '/', '/index.html', '/login' ]) {
        const res = await request(app).get(path).set('Accept-Encoding', 'gzip, br');
        expect(res.status).toBe(200);
        expect(res.headers['content-encoding']).toBeUndefined();
        expect(res.headers['cache-control']).toBe('no-store');
        expect(res.headers['content-security-policy']).toBe(contentSecurityPolicy(nonceOf(res.text)));
      }
      expect((await request(app).get('/index.html.gz')).status).toBe(404);
    });
  });

  describe('caching', () => {
    function cachingApp(): express.Application {
      writeFileSync(join(webRoot, 'index.html'), INDEX);
      for (const file of [ 'main-ABCD1234.js', 'styles-ABCD1234.css', 'favicon.ico', 'main.js', 'styles.css' ]) {
        writeFileSync(join(webRoot, file), file);
      }
      writeFileSync(join(webRoot, 'main-ABCD1234.js.gz'), gzipSync('main-ABCD1234.js'));
      for (
        const [ dir, file ] of [ [ 'media', 'inter-ABCD1234.woff2' ], [ 'assets', 'icons.svg' ], [ 'i18n', 'en.json' ] ]
      ) {
        mkdirSync(join(webRoot, dir));
        writeFileSync(join(webRoot, dir, file), JSON.stringify(file));
      }
      const app = express();
      serveWebClient(app, webRoot, { version: '1.4.2' });
      return app;
    }

    it.each([
      [ '/main-ABCD1234.js', 'identity' ],
      [ '/main-ABCD1234.js', 'gzip' ],
      [ '/styles-ABCD1234.css', 'gzip' ],
      [ '/media/inter-ABCD1234.woff2', 'gzip' ]
    ])('caches %s (%s) for good: the build names it by its content', async (path, acceptEncoding) => {
      const res = await request(cachingApp()).get(path).set('Accept-Encoding', acceptEncoding);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe(VERSIONED_CACHE_CONTROL);
    });

    it.each([ '/assets/icons.svg', '/i18n/en.json', '/favicon.ico', '/main.js', '/styles.css' ])(
      'keeps max-age=0 for %s (a development build names main.js and styles.css without a hash)',
      async path => {
        const res = await request(cachingApp()).get(path);
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('public, max-age=0');
      }
    );

    it('keeps max-age=0 for a file in media/ without a hash', async () => {
      const app = cachingApp();
      writeFileSync(join(webRoot, 'media', 'inter.woff2'), 'font');
      const res = await request(app).get('/media/inter.woff2');
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('public, max-age=0');
    });

    it('caches a file asked for with ?v=<version> for good', async () => {
      const res = await request(cachingApp()).get('/i18n/en.json?v=1.4.2');
      expect(res.headers['cache-control']).toBe(VERSIONED_CACHE_CONTROL);
    });

    it('does not cache a missing hashed file', async () => {
      const res = await request(cachingApp()).get('/chunk-MISSING1.js');
      expect(res.status).toBe(404);
      expect(res.headers['cache-control']).not.toBe(VERSIONED_CACHE_CONTROL);
    });
  });

  describe('the preloads of the first route (A-7.9)', () => {
    const HEAD_INDEX = '<html><head><title>Front Burner</title></head>'
      + '<body><app-root ngCspNonce="__CSP_NONCE__"></app-root></body></html>';
    const GROUPS = {
      shell: [ 'chunk-shell001.js', 'chunk-common01.js' ],
      dashboard: [ 'chunk-dashbrd1.js', 'chunk-common01.js' ],
      'repository-screen': [ 'chunk-reposcr1.js' ],
      editor: [ 'chunk-editor01.js', 'chunk-reposcr1.js' ],
      auth: [ 'chunk-auth0001.js' ]
    };

    function preloadApp(
      chunkMap: unknown = { version: 1, groups: GROUPS },
      warn: (message: string) => void = vi.fn()
    ): express.Application {
      writeFileSync(join(webRoot, 'index.html'), HEAD_INDEX);
      for (const file of new Set(Object.values(GROUPS).flat())) {
        writeFileSync(join(webRoot, file), file);
      }
      // `null`: no chunk map at all.
      if (chunkMap !== null) {
        writeFileSync(join(dist, 'chunk-map.json'), JSON.stringify(chunkMap));
      }
      const app = express();
      serveWebClient(app, webRoot, { warn });
      return app;
    }

    /** The `modulepreload` links of a page, in order, each checked to carry the page's nonce. */
    function modulePreloads(body: string): string[] {
      const nonce = nonceOf(body);
      return [ ...body.matchAll(/<link rel="modulepreload" href="([^"]+)" nonce="([^"]+)">/g) ].map(match => {
        expect(match[2]).toBe(nonce);
        return match[1];
      });
    }

    it('preloads the shell\'s and the dashboard\'s chunks on /, with the nonce', async () => {
      const res = await request(preloadApp()).get('/');
      expect(modulePreloads(res.text)).toEqual([ 'chunk-shell001.js', 'chunk-common01.js', 'chunk-dashbrd1.js' ]);
      // Before </head>, so that the browser starts them before it reaches the body.
      expect(res.text.indexOf('modulepreload')).toBeLessThan(res.text.indexOf('</head>'));
    });

    it('preloads the repository screen\'s on /repositories/1, and the editor\'s too on a Markdown file', async () => {
      const app = preloadApp();
      expect(modulePreloads((await request(app).get('/repositories/1')).text)).toEqual([ 'chunk-reposcr1.js' ]);
      expect(modulePreloads((await request(app).get('/repositories/1/files/docs/a.md')).text)).toEqual([
        'chunk-reposcr1.js',
        'chunk-editor01.js'
      ]);
      expect(modulePreloads((await request(app).get('/repositories/1/files/docs/A.MDX')).text)).toEqual([
        'chunk-reposcr1.js',
        'chunk-editor01.js'
      ]);
    });

    it.each([ '/repositories/abc', '/some/route', '/repositories/0', '/repositoriesx/1', '/%E0%A4%A' ])(
      'preloads no chunk for %s',
      async path => {
        const res = await request(preloadApp()).get(path);
        expect(res.status).toBe(200);
        expect(modulePreloads(res.text)).toEqual([]);
      }
    );

    it('preloads only the repository screen\'s for a file that is not Markdown', async () => {
      const res = await request(preloadApp()).get('/repositories/1/files/a.txt');
      expect(modulePreloads(res.text)).toEqual([ 'chunk-reposcr1.js' ]);
    });

    it('matches /REPOSITORIES/1 like /repositories/1, and an encoded or dotted path like its plain form', async () => {
      const app = preloadApp();
      for (const path of [ '/REPOSITORIES/1', '/repositories/1/', '/%72epositories/1', '/x/../repositories/1' ]) {
        expect(modulePreloads((await request(app).get(path)).text)).toEqual([ 'chunk-reposcr1.js' ]);
      }
    });

    it('preloads the login page\'s chunks on /login and /onboarding', async () => {
      const app = preloadApp();
      for (const path of [ '/login', '/login/reset', '/onboarding' ]) {
        expect(modulePreloads((await request(app).get(path)).text)).toEqual([ 'chunk-auth0001.js' ]);
      }
    });

    it('preloads i18n/en.json as fetch on every page', async () => {
      const app = preloadApp();
      for (const path of [ '/', '/some/route' ]) {
        const body = (await request(app).get(path)).text;
        expect(body).toContain(
          `<link rel="preload" href="i18n/en.json" as="fetch" crossorigin="anonymous" nonce="${nonceOf(body)}">`
        );
      }
    });

    it('puts the editor\'s files in #fb-chunk-map', async () => {
      const body = (await request(preloadApp()).get('/repositories/1')).text;
      const match = /<script type="application\/json" id="fb-chunk-map" nonce="([^"]+)">([^<]*)<\/script>/.exec(body);
      expect(match?.[1]).toBe(nonceOf(body));
      expect(JSON.parse(match?.[2] ?? '')).toEqual({ editor: [ 'chunk-editor01.js', 'chunk-reposcr1.js' ] });
    });

    it('drops a listed file that is not in the web root, with one warning', async () => {
      const warn = vi.fn();
      const app = preloadApp({
        version: 1,
        groups: { ...GROUPS, shell: [ 'chunk-shell001.js', 'chunk-stale001.js', 'chunk-stale002.js' ] }
      }, warn);

      expect(modulePreloads((await request(app).get('/')).text)).toEqual([
        'chunk-shell001.js',
        'chunk-dashbrd1.js',
        'chunk-common01.js'
      ]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toMatch(/names 2 files/);
    });

    it('drops a name that is not a plain file of the web root', async () => {
      writeFileSync(join(dist, 'outside.js'), 'outside');
      const warn = vi.fn();
      const app = preloadApp({ version: 1, groups: { shell: [ '../outside.js', 'a"><script>.js' ] } }, warn);
      const body = (await request(app).get('/')).text;
      expect(modulePreloads(body)).toEqual([]);
      expect(body).not.toContain('outside.js');
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('adds nothing without a chunk map', async () => {
      const warn = vi.fn();
      const body = (await request(preloadApp(null, warn)).get('/')).text;
      expect(body).toBe(HEAD_INDEX.replace('__CSP_NONCE__', nonceOf(body)));
      expect(warn).not.toHaveBeenCalled();
    });

    it('adds nothing, with one warning, when the chunk map cannot be read', async () => {
      const warn = vi.fn();
      const body = (await request(preloadApp({ version: 2, groups: {} }, warn)).get('/')).text;
      expect(body).not.toContain('preload');
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });
});
