import express from 'express';
import request from 'supertest';
import { PERMISSIONS_POLICY, securityHeaders } from './security-headers';

function createApp(trustProxy = false): express.Application {
  const app = express();
  if (trustProxy) {
    app.set('trust proxy', true);
  }
  app.use(securityHeaders());
  app.get('/', (_req, res) => {
    res.send('ok');
  });
  return app;
}

describe('securityHeaders', () => {
  it('sets NF-11.2\'s headers', async () => {
    const res = await request(createApp()).get('/');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['permissions-policy']).toBe(PERMISSIONS_POLICY);
    expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
  });

  it('sends HSTS only over HTTPS', async () => {
    const plain = await request(createApp(true)).get('/');
    expect(plain.headers['strict-transport-security']).toBeUndefined();
    const secure = await request(createApp(true)).get('/').set('X-Forwarded-Proto', 'https');
    expect(secure.headers['strict-transport-security']).toBe('max-age=31536000');
  });

  it('does not trust a forwarded protocol unless the app trusts the proxy', async () => {
    const res = await request(createApp()).get('/').set('X-Forwarded-Proto', 'https');
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  it('allows clipboard-write for the page itself only', () => {
    expect(PERMISSIONS_POLICY).toContain('clipboard-write=(self)');
    expect(PERMISSIONS_POLICY).toContain('camera=()');
    expect(PERMISSIONS_POLICY).not.toContain('clipboard-read');
    expect(PERMISSIONS_POLICY.match(/clipboard-write=\(self\)/g)).toHaveLength(1);
  });
});
