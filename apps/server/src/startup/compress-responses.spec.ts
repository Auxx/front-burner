import { serverTiming } from '@front-burner/server-core-observability';
import express from 'express';
import request from 'supertest';
import { compressResponses } from './compress-responses';

const BIG = { entries: Array.from({ length: 100 }, (_, i) => ({ name: `file-${i}.md`, type: 'file' })) };

describe('compressResponses', () => {
  function createApp(): express.Application {
    const app = express();
    app.use(compressResponses());
    app.get('/api/v1/repositories/1/tree', (_req, res) => {
      res.json(BIG);
    });
    app.get('/api/v1/small', (_req, res) => {
      res.json({ ok: true });
    });
    app.get('/api/v1/events', (_req, res) => {
      res.status(200).set('Content-Type', 'text/event-stream');
      res.flushHeaders();
      res.write(`event: big\ndata: ${JSON.stringify(BIG)}\n\n`);
      res.end();
    });
    for (
      const path of [ '/api/v1/auth/login', '/api/v1/auth/refresh', '/api/v1/auth/oidc/exchange', '/api/v1/onboarding' ]
    ) {
      app.post(path, (_req, res) => {
        res.json({ authToken: 'secret', ...BIG });
      });
    }
    app.get('/assets/big.json', (_req, res) => {
      res.json(BIG);
    });
    return app;
  }

  it('NF-2.1: gzips a JSON answer of 1 KB or more', async () => {
    const res = await request(createApp()).get('/api/v1/repositories/1/tree').set('Accept-Encoding', 'gzip');
    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(res.headers['vary']).toBe('Accept-Encoding');
    expect(res.body).toEqual(BIG);
  });

  it('sends Brotli when the client prefers it', async () => {
    const res = await request(createApp()).get('/api/v1/repositories/1/tree').set('Accept-Encoding', 'gzip, br');
    expect(res.headers['content-encoding']).toBe('br');
    expect(res.body).toEqual(BIG);
  });

  it('leaves a small answer as it is', async () => {
    const res = await request(createApp()).get('/api/v1/small').set('Accept-Encoding', 'gzip, br');
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.body).toEqual({ ok: true });
  });

  it('A-3.10: leaves text/event-stream as it is', async () => {
    const res = await request(createApp()).get('/api/v1/events').set('Accept-Encoding', 'gzip, br');
    expect(res.headers['content-type']).toMatch(/^text\/event-stream/);
    expect(res.headers['content-encoding']).toBeUndefined();
  });

  it.each([
    '/api/v1/auth/login',
    '/api/v1/auth/refresh',
    '/api/v1/auth/oidc/exchange',
    '/api/v1/onboarding',
    '/API/V1/Auth/login',
    '/api/v1/%61uth/login'
  ])('A-7.15: leaves the answer of %s as it is (BREACH)', async path => {
    const res = await request(createApp()).post(path).set('Accept-Encoding', 'gzip, br');
    expect(res.headers['content-encoding']).toBeUndefined();
  });

  it('A-7.14: keeps Server-Timing on a compressed answer', async () => {
    const app = express();
    app.use(serverTiming({ except: [] }));
    app.use(compressResponses());
    app.get('/api/v1/tree', (_req, res) => {
      res.json(BIG);
    });
    const res = await request(app).get('/api/v1/tree').set('Accept-Encoding', 'gzip');
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(res.headers['server-timing']).toMatch(/^app;dur=\d+\.\d$/);
  });

  describe('a strong ETag, as a repository image sends', () => {
    const SVG = `<svg xmlns="http://www.w3.org/2000/svg">${'<rect width="1" height="1"/>'.repeat(100)}</svg>`;

    function imageApp(body: string): express.Application {
      const app = express();
      app.use(compressResponses());
      app.get('/api/v1/repositories/1/image', (_req, res) => {
        res.set('ETag', '"3000-1700000000000"').type('image/svg+xml').send(body);
      });
      return app;
    }

    it('becomes weak when the answer is compressed', async () => {
      const res = await request(imageApp(SVG)).get('/api/v1/repositories/1/image').set('Accept-Encoding', 'gzip');
      expect(res.headers['content-encoding']).toBe('gzip');
      expect(res.headers['etag']).toBe('W/"3000-1700000000000"');
    });

    it.each([ [ 'identity', SVG ], [ 'gzip', '<svg/>' ] ])(
      'stays strong when the answer is sent as it is (Accept-Encoding: %s)',
      async (acceptEncoding, body) => {
        const res = await request(imageApp(body))
          .get('/api/v1/repositories/1/image')
          .set('Accept-Encoding', acceptEncoding);
        expect(res.headers['content-encoding']).toBeUndefined();
        expect(res.headers['etag']).toBe('"3000-1700000000000"');
      }
    );
  });

  it('leaves answers outside the API to the web client\'s handler', async () => {
    const res = await request(createApp()).get('/assets/big.json').set('Accept-Encoding', 'gzip, br');
    expect(res.headers['content-encoding']).toBeUndefined();
  });
});
