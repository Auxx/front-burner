import BetterSqlite3 from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type ServerProcess, startServerProcess } from './support/server-process';

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
