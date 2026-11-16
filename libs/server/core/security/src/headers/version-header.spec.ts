import express from 'express';
import request from 'supertest';
import { versionHeader } from './version-header';

function createApp(): express.Application {
  const app = express();
  app.use(versionHeader('1.4.2', { except: [ 'api/health/live', 'api/health/ready' ] }));
  app.get('/api/v1/session', (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/api/v1/broken', () => {
    throw new Error('broken');
  });
  app.get('/api/health/live', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.get('/api/healthy', (_req, res) => {
    res.send('ok');
  });
  return app;
}

describe('versionHeader', () => {
  it('sets the version on every API response', async () => {
    const res = await request(createApp()).get('/api/v1/session');
    expect(res.headers['x-front-burner-version']).toBe('1.4.2');
  });

  it('sets the version on errors too', async () => {
    const missing = await request(createApp()).get('/api/v1/nope');
    expect(missing.status).toBe(404);
    expect(missing.headers['x-front-burner-version']).toBe('1.4.2');
    const failed = await request(createApp()).get('/api/v1/broken');
    expect(failed.status).toBe(500);
    expect(failed.headers['x-front-burner-version']).toBe('1.4.2');
  });

  it('sets the version on a 304', async () => {
    const first = await request(createApp()).get('/api/v1/session');
    const res = await request(createApp()).get('/api/v1/session').set('If-None-Match', first.headers['etag']);
    expect(res.status).toBe(304);
    expect(res.headers['x-front-burner-version']).toBe('1.4.2');
  });

  it('the health endpoints have no version', async () => {
    const res = await request(createApp()).get('/api/health/live');
    expect(res.status).toBe(200);
    expect(res.headers['x-front-burner-version']).toBeUndefined();
  });

  it('leaves them out however the router reaches them: in another case or with a trailing slash', async () => {
    for (const path of [ '/API/Health/Live', '/api/HEALTH/live/' ]) {
      const res = await request(createApp()).get(path);
      expect(res.status, path).toBe(200);
      expect(res.headers['x-front-burner-version'], path).toBeUndefined();
    }
  });

  it('only leaves out the health endpoints themselves', async () => {
    for (const path of [ '/api/healthy', '/api/health/other', '/api/health' ]) {
      const res = await request(createApp()).get(path);
      expect(res.headers['x-front-burner-version'], path).toBe('1.4.2');
    }
  });
});
