import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BUILD_VERSION,
  E2E_ADMIN,
  E2E_SETUP_TOKEN,
  login,
  onboard,
  seed,
  type ServerProcess,
  startServerProcess
} from './support/server-process';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('server API', () => {
  let server: ServerProcess;

  beforeAll(async () => {
    server = await startServerProcess();
  });

  afterAll(async () => {
    await server?.stop();
  });

  it('live and ready answer ok', async () => {
    for (const path of [ 'live', 'ready' ]) {
      const response = await fetch(`${server.url}/api/health/${path}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 'ok' });
      expect(response.headers.get('x-request-id')).toMatch(UUID);
    }
  });

  it('API responses carry NF-11.2 headers, no HSTS over HTTP, no X-RateLimit headers', async () => {
    const response = await fetch(`${server.url}/api/health/live`);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('permissions-policy')).toBeTruthy();
    expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(response.headers.get('strict-transport-security')).toBeNull();
    const rateLimit = [ ...response.headers.keys() ].filter(name => name.startsWith('x-ratelimit'));
    expect(rateLimit).toEqual([]);
  });

  it('sets the version on every API response, errors included', async () => {
    for (const path of [ '/api/v1/auth/methods', '/api/v1/me', '/api/v1/nope', '/api/nope' ]) {
      const response = await fetch(`${server.url}${path}`);
      expect(response.headers.get('x-front-burner-version'), path).toBe(BUILD_VERSION);
    }
  });

  it('the health endpoints have no version, in any case the router accepts', async () => {
    for (const path of [ 'health/live', 'health/ready', 'HEALTH/Live', 'health/ready/' ]) {
      const response = await fetch(`${server.url}/api/${path}`);
      expect(response.status, path).toBe(200);
      expect(response.headers.get('x-front-burner-version'), path).toBeNull();
    }
  });

  it('unknown API path returns the JSON 404', async () => {
    const response = await fetch(`${server.url}/api/nope`);
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    const body = (await response.json()) as { code: string; requestId: string; };
    expect(body.code).toBe('not-found');
    expect(body.requestId).toBe(response.headers.get('x-request-id'));
  });

  it('unknown API path returns the JSON 404 even for HTML requests', async () => {
    const response = await fetch(`${server.url}/api/nope`, { headers: { accept: 'text/html' } });
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(((await response.json()) as { code: string; }).code).toBe('not-found');
  });

  it('refuses a JSON body over 2 MB with 413 payload-too-large', async () => {
    const response = await fetch(`${server.url}/api/nope`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'x'.repeat(2 * 1024 * 1024 + 1) })
    });
    expect(response.status).toBe(413);
    expect(((await response.json()) as { code: string; }).code).toBe('payload-too-large');
  });

  it('refuses malformed JSON with 400 malformed-request', async () => {
    const response = await fetch(`${server.url}/api/nope`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"broken":'
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string; }).code).toBe('malformed-request');
  });
});

describe('instance storage', () => {
  let server: ServerProcess;

  beforeAll(async () => {
    // A threshold above any runner's free space, so that storage is low.
    server = await startServerProcess({
      FRONT_BURNER_SETUP_TOKEN: E2E_SETUP_TOKEN,
      FRONT_BURNER_LOW_DISK_THRESHOLD: '1000000GB'
    });
    await onboard(server);
  });

  afterAll(async () => {
    await server?.stop();
  });

  const storage = (authToken?: string) =>
    fetch(`${server.url}/api/v1/instance/storage`, {
      headers: authToken === undefined ? {} : { authorization: `Bearer ${authToken}` }
    });

  it('NF-9.7: tells an administrator that storage is low', async () => {
    const response = await storage((await login(server, 'body')).authToken);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ low: true });
  });

  it('A-7.5: the endpoint is for administrators only', async () => {
    seed(server.dataDir, { users: [ { email: 'bob@example.com' } ] });
    const bob = await login(server, 'body', { email: 'bob@example.com', password: E2E_ADMIN.password });

    const refused = await storage(bob.authToken);
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { code: string; }).code).toBe('forbidden');

    const anonymous = await storage();
    expect(anonymous.status).toBe(401);
    expect(((await anonymous.json()) as { code: string; }).code).toBe('unauthenticated');
  });
});

describe('metrics', () => {
  const METRICS_TOKEN = 'e2e-metrics-token-0123456789';
  let server: ServerProcess;

  beforeAll(async () => {
    server = await startServerProcess({
      FRONT_BURNER_SETUP_TOKEN: E2E_SETUP_TOKEN,
      FRONT_BURNER_METRICS_TOKEN: METRICS_TOKEN
    });
    await onboard(server);
  });

  afterAll(async () => {
    await server?.stop();
  });

  const scrape = async () => {
    const response = await fetch(`${server.url}/api/metrics`, {
      headers: { authorization: `Bearer ${METRICS_TOKEN}` }
    });
    expect(response.status).toBe(200);
    return response.text();
  };

  it('NF-10.10: refuses a scrape without the token', async () => {
    const response = await fetch(`${server.url}/api/metrics`, { headers: { authorization: 'Bearer wrong' } });
    expect(response.status).toBe(401);
    expect(response.headers.get('x-front-burner-version')).toBeNull();
  });

  it('NF-10.11: metrics show a request after it is made', async () => {
    const { authToken } = await login(server, 'body');
    const me = await fetch(`${server.url}/api/v1/me`, { headers: { authorization: `Bearer ${authToken}` } });
    expect(me.status).toBe(200);

    const metrics = await scrape();
    expect(metrics).toMatch(
      /^front_burner_http_request_duration_seconds_count\{method="GET",route="\/api\/v1\/me",status="200"\} [1-9]/m
    );
    expect(metrics).toMatch(/^front_burner_active_sessions [1-9]/m);
    expect(metrics).toMatch(/^front_burner_process_resident_memory_bytes /m);
  });

  it('NF-10.11: no metric label holds a user, repository or path', async () => {
    const { authToken } = await login(server, 'body');
    const headers = { authorization: `Bearer ${authToken}` };
    await fetch(`${server.url}/api/v1/repositories/987654`, { headers });
    await fetch(`${server.url}/api/v1/repositories/987654/files/notes/secret-plan.md`, { headers });
    await fetch(`${server.url}/api/v1/no-such-route/secret-plan.md`, { headers });

    const metrics = await scrape();
    const labelValues = [ ...metrics.matchAll(/="([^"]*)"/g) ].map(match => match[1]);
    expect(labelValues).toContain('/api/v1/repositories/:id');
    expect(labelValues).toContain('unmatched');
    for (const value of labelValues) {
      for (const secret of [ E2E_ADMIN.email, 'admin', '987654', 'secret-plan', 'no-such-route', authToken ]) {
        expect(value).not.toContain(secret);
      }
    }
    const routes = new Set([ ...metrics.matchAll(/route="([^"]*)"/g) ].map(match => match[1]));
    for (const route of routes) {
      expect(route === 'unmatched' || /^\/api\/[\w/:-]+$/.test(route), route).toBe(true);
    }
  });
});
