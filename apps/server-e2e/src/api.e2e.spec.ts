import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ServerProcess, startServerProcess } from './support/server-process';

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

  it('unknown API path returns the JSON 404', async () => {
    const response = await fetch(`${server.url}/api/nope`);
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    const body = await response.json();
    expect(body.code).toBe('not-found');
    expect(body.requestId).toBe(response.headers.get('x-request-id'));
  });

  it('unknown API path returns the JSON 404 even for HTML requests', async () => {
    const response = await fetch(`${server.url}/api/nope`, { headers: { accept: 'text/html' } });
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect((await response.json()).code).toBe('not-found');
  });

  it('refuses a JSON body over 2 MB with 413 payload-too-large', async () => {
    const response = await fetch(`${server.url}/api/nope`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'x'.repeat(2 * 1024 * 1024 + 1) })
    });
    expect(response.status).toBe(413);
    expect((await response.json()).code).toBe('payload-too-large');
  });

  it('refuses malformed JSON with 400 malformed-request', async () => {
    const response = await fetch(`${server.url}/api/nope`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"broken":'
    });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('malformed-request');
  });
});
