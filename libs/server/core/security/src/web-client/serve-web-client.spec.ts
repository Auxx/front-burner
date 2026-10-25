import express from 'express';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { contentSecurityPolicy } from '../csp/csp';
import { serveWebClient } from './serve-web-client';

const INDEX = '<html><body><app-root ngCspNonce="__CSP_NONCE__"></app-root></body></html>';

describe('serveWebClient', () => {
  let webRoot: string;

  beforeEach(() => {
    webRoot = mkdtempSync(join(tmpdir(), 'fb-web-'));
  });

  afterEach(() => {
    rmSync(webRoot, { recursive: true, force: true });
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

  it('uses a new nonce per request', async () => {
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

  it('serves an existing file in a folder', async () => {
    mkdirSync(join(webRoot, 'assets'));
    writeFileSync(join(webRoot, 'assets', 'a.txt'), 'hello');
    const res = await request(createApp()).get('/assets/a.txt');
    expect(res.status).toBe(200);
    expect(res.text).toBe('hello');
  });

  it.each([ '/index.html', '/%69ndex.html', '/./index.html', '/INDEX.HTML' ])(
    'templates %s like any route',
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
});
