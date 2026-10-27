import { TEST_CERTIFICATE_FILES } from '@front-burner/server-core-security/testing';
import { type MockOidcProvider, startMockOidcProvider } from '@front-burner/server-feature-auth/testing';
import BetterSqlite3 from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent, fetch as fetchTrusting } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { login, postJson, type ServerProcess, startServerProcess } from './support/server-process';

const TOKEN = 'e2e-setup-token-0123456789abcdef';
const ONBOARDING = '/api/v1/onboarding';
const CHECK = `${ONBOARDING}/setup-token/check`;
const SETUP = `${ONBOARDING}/password-setup`;

const details = { email: 'admin@example.com', displayName: 'Admin', password: 'correct horse 1' };

// Per-request values: the ETag hashes a body that carries the request ID, so it
// differs between any two 404s, unknown routes included.
const PER_REQUEST_HEADERS = new Set([ 'x-request-id', 'etag', 'date' ]);

interface Captured {
  status: number;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

async function capture(response: Response): Promise<Captured> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    if (!PER_REQUEST_HEADERS.has(name)) {
      headers[name] = value;
    }
  });
  const body = (await response.json()) as Record<string, unknown>;
  delete body['requestId'];
  return { status: response.status, body, headers };
}

function post(server: ServerProcess, path: string, body: unknown): Promise<Response> {
  return fetch(`${server.url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

/** Expects `response` to be the same as the same request to an unknown route (AO-3). */
async function expectSameAsUnknownRoute(
  server: ServerProcess,
  response: Response,
  method: 'GET' | 'POST',
  body?: unknown
): Promise<void> {
  const unknown = method === 'GET'
    ? await fetch(`${server.url}${ONBOARDING}/nope`)
    : await post(server, `${ONBOARDING}/nope`, body);
  const [ actual, expected ] = [ await capture(response), await capture(unknown) ];
  expect(actual.status).toBe(404);
  expect(actual).toEqual(expected);
}

function countUsers(dataDir: string): number {
  const sqlite = new BetterSqlite3(join(dataDir, 'db', 'front-burner.sqlite'), { readonly: true });
  try {
    return (sqlite.prepare('SELECT count(*) AS n FROM users').get() as { n: number; }).n;
  } finally {
    sqlite.close();
  }
}

describe('administrator onboarding', () => {
  const cleanups: (() => void | Promise<void>)[] = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      await cleanup();
    }
  });

  /** A data directory that outlives one server, for restarts and counting users. */
  function ownDataDir(): string {
    const dataDir = mkdtempSync(join(tmpdir(), 'front-burner-e2e-onboarding-'));
    cleanups.push(() => rmSync(dataDir, { recursive: true, force: true }));
    return dataDir;
  }

  async function start(env: Record<string, string> = { FRONT_BURNER_SETUP_TOKEN: TOKEN }): Promise<ServerProcess> {
    const server = await startServerProcess(env);
    cleanups.push(() => server.stop());
    return server;
  }

  async function state(server: ServerProcess): Promise<unknown> {
    return (await (await fetch(`${server.url}${ONBOARDING}`)).json() as { state: unknown; }).state;
  }

  it('AC2 without a token, data-changing requests answer 404', async () => {
    const server = await start({});
    expect(await (await fetch(`${server.url}${ONBOARDING}`)).json()).toEqual({
      state: 'required',
      oidcFromEnvironment: false,
      setupTokenConfigured: false
    });
    await expectSameAsUnknownRoute(server, await post(server, CHECK, { setupToken: TOKEN }), 'POST', {
      setupToken: TOKEN
    });
    const setup = { setupToken: TOKEN, ...details };
    await expectSameAsUnknownRoute(server, await post(server, SETUP, setup), 'POST', setup);
  });

  it('AC3 a missing or wrong token answers 404 and changes nothing', async () => {
    const server = await start();
    for (const body of [ details, { setupToken: `${TOKEN}x`, ...details } ]) {
      await expectSameAsUnknownRoute(server, await post(server, SETUP, body), 'POST', body);
    }
    expect(await state(server)).toBe('required');
  });

  it('a wrong token with an invalid body is indistinguishable from an unknown route', async () => {
    const server = await start();
    const body = { setupToken: 'x' };
    await expectSameAsUnknownRoute(server, await post(server, SETUP, body), 'POST', body);
  });

  it('AC4 password setup completes onboarding', async () => {
    const dataDir = ownDataDir();
    const server = await start({ FRONT_BURNER_SETUP_TOKEN: TOKEN, FRONT_BURNER_DATA_DIR: dataDir });

    expect((await post(server, CHECK, { setupToken: TOKEN })).status).toBe(204);
    expect((await post(server, SETUP, { setupToken: TOKEN, ...details })).status).toBe(204);
    // Criterion 4: that user can log in.
    await expect(login(server, 'cookie', details)).resolves.toMatchObject({ authToken: expect.any(String) });

    await expectSameAsUnknownRoute(server, await fetch(`${server.url}${ONBOARDING}`), 'GET');
    await expectSameAsUnknownRoute(server, await post(server, CHECK, { setupToken: TOKEN }), 'POST', {
      setupToken: TOKEN
    });
    const again = { setupToken: TOKEN, ...details, email: 'other@example.com' };
    await expectSameAsUnknownRoute(server, await post(server, SETUP, again), 'POST', again);

    await server.stop();
    expect(countUsers(dataDir)).toBe(1);
  });

  it('AC5 a policy-failing password is refused', async () => {
    const server = await start();
    const response = await post(server, SETUP, { setupToken: TOKEN, ...details, password: 'abcdefghij' });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { code: string; fields: { path: string; code: string; }[]; };
    expect(body.code).toBe('validation-failed');
    expect(body.fields).toEqual([ expect.objectContaining({ path: 'password', code: 'too-few-classes' }) ]);
    expect(await state(server)).toBe('required');
  });

  it('AC13 two simultaneous setups create one administrator', async () => {
    const dataDir = ownDataDir();
    const server = await start({ FRONT_BURNER_SETUP_TOKEN: TOKEN, FRONT_BURNER_DATA_DIR: dataDir });

    const responses = await Promise.all([
      post(server, SETUP, { setupToken: TOKEN, ...details, email: 'one@example.com' }),
      post(server, SETUP, { setupToken: TOKEN, ...details, email: 'two@example.com' })
    ]);

    expect(responses.map(response => response.status).sort()).toEqual([ 204, 404 ]);
    await server.stop();
    expect(countUsers(dataDir)).toBe(1);
  });

  it('AC14 a completed instance stays closed after a restart', async () => {
    const dataDir = ownDataDir();
    const env = { FRONT_BURNER_SETUP_TOKEN: TOKEN, FRONT_BURNER_DATA_DIR: dataDir };
    const first = await start(env);
    expect((await post(first, SETUP, { setupToken: TOKEN, ...details })).status).toBe(204);
    await first.stop();

    const second = await start(env);
    await expectSameAsUnknownRoute(second, await fetch(`${second.url}${ONBOARDING}`), 'GET');
    const body = { setupToken: TOKEN, ...details, email: 'other@example.com' };
    await expectSameAsUnknownRoute(second, await post(second, SETUP, body), 'POST', body);
    await second.stop();
    expect(countUsers(dataDir)).toBe(1);
  });

  it('the setup-token group is limited to 10 per minute', async () => {
    const server = await start();
    for (let i = 0; i < 10; i++) {
      const response = i % 2 === 0
        ? await post(server, CHECK, { setupToken: 'wrong' })
        : await post(server, SETUP, { setupToken: 'wrong' });
      expect(response.status).toBe(404);
    }
    const limited = await post(server, CHECK, { setupToken: TOKEN });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toMatch(/^[1-9]\d*$/);
  });

  it('the limit stays on after onboarding is completed', async () => {
    const server = await start();
    expect((await post(server, SETUP, { setupToken: TOKEN, ...details })).status).toBe(204);
    for (let i = 0; i < 9; i++) {
      expect((await post(server, CHECK, { setupToken: TOKEN })).status).toBe(404);
    }
    expect((await post(server, CHECK, { setupToken: TOKEN })).status).toBe(429);
  });

  it('a short token is ignored with a warning', async () => {
    const server = await start({ FRONT_BURNER_SETUP_TOKEN: 'fifteen-chars-x' });
    expect(
      ((await (await fetch(`${server.url}${ONBOARDING}`)).json()) as { setupTokenConfigured: boolean; })
        .setupTokenConfigured
    ).toBe(false);
    expect(server.output()).toContain('shorter than 16 characters');
  });

  it('logs no secret', async () => {
    const server = await start({ FRONT_BURNER_SETUP_TOKEN: TOKEN, FRONT_BURNER_LOG_LEVEL: 'info' });
    await post(server, CHECK, { setupToken: 'a-wrong-token-0123456789' });
    await post(server, SETUP, { setupToken: TOKEN, ...details });
    const output = server.output();
    expect(output).toContain('Setup token rejected');
    expect(output).toContain('Administrator onboarding completed');
    for (const secret of [ TOKEN, 'a-wrong-token-0123456789', details.password, details.email ]) {
      expect(output).not.toContain(secret);
    }
  });
});

describe('administrator onboarding with OIDC', () => {
  const OIDC_SETUP = `${ONBOARDING}/oidc-setup`;
  const ADMIN_EMAIL = 'admin@example.com';
  let provider: MockOidcProvider;
  let browser: Agent;
  let server: ServerProcess | undefined;

  const setup = (overrides: Record<string, unknown> = {}) => ({
    setupToken: TOKEN,
    issuer: provider.issuer,
    clientId: 'front-burner',
    clientSecret: 'e2e-client-secret',
    adminEmail: ADMIN_EMAIL,
    ...overrides
  });

  async function start(env: Record<string, string> = {}): Promise<ServerProcess> {
    server = await startServerProcess({ FRONT_BURNER_SETUP_TOKEN: TOKEN, ...env }, {
      extraCaFile: TEST_CERTIFICATE_FILES.cert
    });
    return server;
  }

  /** start → provider → callback, as a browser would; returns where the callback sends the browser. */
  async function throughProvider(target: ServerProcess): Promise<{ location: string; cookie: string; }> {
    const started = await fetch(`${target.url}/api/v1/auth/oidc/start`, { redirect: 'manual' });
    const cookie = started.headers.getSetCookie()[0]?.split(';')[0] ?? '';
    const authorized = await fetchTrusting(started.headers.get('location') ?? '', {
      redirect: 'manual',
      dispatcher: browser
    });
    const callback = new URL(authorized.headers.get('location') ?? '');
    const back = await fetch(`${target.url}${callback.pathname}${callback.search}`, {
      redirect: 'manual',
      headers: { cookie }
    });
    return {
      location: back.headers.get('location') ?? '',
      cookie: back.headers.getSetCookie()[0]?.split(';')[0] ?? ''
    };
  }

  async function logIn(target: ServerProcess): Promise<Response> {
    const { location, cookie } = await throughProvider(target);
    const code = new URL(location, 'http://x').searchParams.get('code') ?? '';
    return postJson(target, '/api/v1/auth/oidc/exchange', { code }, { cookie });
  }

  const state = async (target: ServerProcess) =>
    ((await (await fetch(`${target.url}${ONBOARDING}`)).json()) as { state: string; }).state;

  const users = (target: ServerProcess) => {
    const sqlite = new BetterSqlite3(join(target.dataDir, 'db', 'front-burner.sqlite'), { readonly: true });
    try {
      return sqlite.prepare('SELECT email, role, login_method FROM users ORDER BY id').all();
    } finally {
      sqlite.close();
    }
  };

  beforeEach(async () => {
    provider = await startMockOidcProvider();
    provider.setClaims({ email: ADMIN_EMAIL });
    browser = new Agent({ connect: { ca: provider.ca } });
  });

  afterEach(async () => {
    await server?.stop();
    server = undefined;
    await provider.stop();
    await browser.close();
  });

  it('criterion 6: saving the setup, then the first OIDC login creates the administrator', async () => {
    const target = await start();
    expect((await post(target, OIDC_SETUP, setup())).status).toBe(204);
    expect(await state(target)).toBe('oidc-pending');
    const methods = await (await fetch(`${target.url}/api/v1/auth/methods`)).json();
    expect(methods).toMatchObject({ oidc: 'available' });

    const tokens = await logIn(target);
    expect(tokens.status).toBe(200);
    expect(users(target)).toEqual([ { email: ADMIN_EMAIL, role: 'administrator', login_method: 'oidc' } ]);

    await expectSameAsUnknownRoute(target, await fetch(`${target.url}${ONBOARDING}`), 'GET');
    await expectSameAsUnknownRoute(target, await post(target, OIDC_SETUP, setup()), 'POST', setup());
  });

  it('criterion 7: a failed login comes back to onboarding, and saving with the secret blank keeps it', async () => {
    const target = await start();
    expect((await post(target, OIDC_SETUP, setup())).status).toBe(204);

    provider.failTokenRequest(401);
    const failed = await throughProvider(target);
    expect(failed.location).toBe('/onboarding?oidcError=code-exchange-failed');
    expect(users(target)).toEqual([]);

    const current = await post(target, `${OIDC_SETUP}/current`, { setupToken: TOKEN });
    expect(current.status).toBe(200);
    const view = await current.json();
    expect(view).toMatchObject({ issuer: provider.issuer, adminEmail: ADMIN_EMAIL, hasClientSecret: true });
    expect(JSON.stringify(view)).not.toContain('e2e-client-secret');

    expect((await post(target, OIDC_SETUP, setup({ clientSecret: '' }))).status).toBe(204);
    expect((await logIn(target)).status).toBe(200);
    expect(users(target)).toHaveLength(1);
  });

  it('criterion 10: the password path discards a pending OIDC setup', async () => {
    const target = await start();
    expect((await post(target, OIDC_SETUP, setup())).status).toBe(204);
    expect((await post(target, SETUP, { setupToken: TOKEN, ...details, email: 'pw@example.com' })).status).toBe(
      204
    );
    expect(users(target)).toEqual([ { email: 'pw@example.com', role: 'administrator', login_method: 'password' } ]);
    const methods = await (await fetch(`${target.url}/api/v1/auth/methods`)).json();
    expect(methods).toMatchObject({ oidc: 'not-configured' });
  });

  it('refuses an issuer that differs from the discovery document\'s', async () => {
    const target = await start();
    const response = await post(target, OIDC_SETUP, setup({ issuer: `${provider.issuer}/` }));
    expect(response.status).toBe(400);
    expect(((await response.json()) as { fields: unknown; }).fields).toEqual([
      { path: 'issuer', code: 'oidc-issuer-mismatch', params: { expected: provider.issuer } }
    ]);
    expect(await state(target)).toBe('required');
  });

  it('saving answers 404 once onboarding is completed', async () => {
    const target = await start();
    expect((await post(target, SETUP, { setupToken: TOKEN, ...details })).status).toBe(204);
    await expectSameAsUnknownRoute(target, await post(target, OIDC_SETUP, setup()), 'POST', setup());
    const body = { setupToken: TOKEN };
    await expectSameAsUnknownRoute(target, await post(target, `${OIDC_SETUP}/current`, body), 'POST', body);
  });

  it('logs the saved setup without the secret', async () => {
    const target = await start({ FRONT_BURNER_LOG_LEVEL: 'info' });
    expect((await post(target, OIDC_SETUP, setup())).status).toBe(204);
    expect(target.output()).toContain('OIDC setup saved');
    expect(target.output()).not.toContain('e2e-client-secret');
  });
});
