import { afterEach, describe, expect, it } from 'vitest';
import {
  E2E_SETUP_TOKEN,
  login,
  onboard,
  postJson,
  type ServerProcess,
  startServerProcess
} from './support/server-process';

const EVENTS = '/api/v1/events';
const LOGOUT = '/api/v1/auth/session/logout';

function openEvents(server: ServerProcess, authToken?: string): Promise<Response> {
  return fetch(`${server.url}${EVENTS}`, {
    headers: authToken === undefined ? {} : { authorization: `Bearer ${authToken}` }
  });
}

/** Resolves with `true` when the stream ends within `ms`, `false` when it is still open. */
async function endsWithin(response: Response, ms: number): Promise<boolean> {
  const reader = response.body?.getReader();
  if (reader === undefined) {
    throw new Error('The response has no body');
  }
  const deadline = Date.now() + ms;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      await reader.cancel();
      return false;
    }
    const result = await Promise.race([
      reader.read(),
      new Promise<'open'>(resolve => setTimeout(() => resolve('open'), remaining))
    ]);
    if (result === 'open') {
      await reader.cancel();
      return false;
    }
    if (result.done) {
      return true;
    }
  }
}

describe('push channel', () => {
  const cleanups: (() => Promise<void>)[] = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      await cleanup();
    }
  });

  async function onboarded(env: Record<string, string> = {}): Promise<ServerProcess> {
    const server = await startServerProcess({ FRONT_BURNER_SETUP_TOKEN: E2E_SETUP_TOKEN, ...env });
    cleanups.push(() => server.stop());
    await onboard(server);
    return server;
  }

  it('streams to a logged-in client', async () => {
    const server = await onboarded();
    const { authToken } = await login(server, 'body');

    const response = await openEvents(server, authToken);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^text\/event-stream\b/);
    expect(response.headers.get('cache-control')).toBe('no-cache');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    expect(await endsWithin(response, 1000)).toBe(false);
  });

  it('closes the stream on logout', async () => {
    const server = await onboarded();
    const { authToken, refreshToken } = await login(server, 'body');
    const response = await openEvents(server, authToken);
    expect(response.status).toBe(200);

    const logout = await postJson(server, LOGOUT, { refreshToken }, { authorization: `Bearer ${authToken}` });
    expect(logout.status).toBe(204);

    expect(await endsWithin(response, 1000)).toBe(true);
  });

  it('refuses a stream without a token', async () => {
    const server = await onboarded();

    const response = await openEvents(server);

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'unauthenticated' });
  });

  it('closes the stream when the auth token expires', async () => {
    const server = await onboarded({ FRONT_BURNER_AUTH_TOKEN_TTL: '2s' });
    const { authToken } = await login(server, 'body');
    const response = await openEvents(server, authToken);
    expect(response.status).toBe(200);

    expect(await endsWithin(response, 4000)).toBe(true);
  });
});
