import { argon2id, hash } from 'argon2';
import BetterSqlite3 from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  E2E_ADMIN,
  E2E_SETUP_TOKEN,
  login,
  onboard,
  postJson,
  refreshCookieOf,
  runServerToExit,
  type ServerProcess,
  startServerProcess
} from './support/server-process';

const LOGIN = '/api/v1/auth/login';
const REFRESH = '/api/v1/auth/session/refresh';
const LOGOUT = '/api/v1/auth/session/logout';
const COOKIE_HEADERS = (token: string) => ({ cookie: `front_burner_refresh=${token}`, 'x-front-burner-refresh': '1' });

const databaseOf = (server: ServerProcess) => join(server.dataDir, 'db', 'front-burner.sqlite');

function withDatabase<T>(server: ServerProcess, use: (sqlite: BetterSqlite3.Database) => T): T {
  const sqlite = new BetterSqlite3(databaseOf(server));
  try {
    return use(sqlite);
  } finally {
    sqlite.close();
  }
}

function auditReasons(server: ServerProcess): string[] {
  return withDatabase(
    server,
    sqlite =>
      (sqlite.prepare('SELECT reason FROM login_audit ORDER BY id').all() as { reason: string; }[]).map(row =>
        row.reason
      )
  );
}

function me(server: ServerProcess, authToken: string): Promise<Response> {
  return fetch(`${server.url}/api/v1/me`, { headers: { authorization: `Bearer ${authToken}` } });
}

async function codeOf(response: Response): Promise<string> {
  return ((await response.json()) as { code: string; }).code;
}

describe('password login and sessions', () => {
  const cleanups: (() => void | Promise<void>)[] = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      await cleanup();
    }
  });

  /** Every test starts its own server: the `login` group allows 10 logins per address per minute. */
  async function start(env: Record<string, string> = {}): Promise<ServerProcess> {
    const server = await startServerProcess({ FRONT_BURNER_SETUP_TOKEN: E2E_SETUP_TOKEN, ...env });
    cleanups.push(() => server.stop());
    return server;
  }

  async function onboarded(env: Record<string, string> = {}): Promise<ServerProcess> {
    const server = await start(env);
    await onboard(server);
    return server;
  }

  function ownDataDir(): string {
    const dataDir = mkdtempSync(join(tmpdir(), 'front-burner-e2e-login-'));
    cleanups.push(() => rmSync(dataDir, { recursive: true, force: true }));
    return dataDir;
  }

  it('AC-AUTH-003.3: a login returns the auth token in the body and the refresh token in a cookie', async () => {
    const server = await onboarded();
    const { response, authToken } = await login(server);

    const body = (await response.json()) as Record<string, unknown>;
    expect(body['refreshToken']).toBeUndefined();
    const cookie = response.headers.getSetCookie().join('\n');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(refreshCookieOf(response)).not.toBe('');

    const current = await me(server, authToken);
    expect(current.status).toBe(200);
    expect(await current.json()).toMatchObject({ email: E2E_ADMIN.email, role: 'administrator' });
  });

  it('AC-AUTH-003.4: an email in another letter case logs in', async () => {
    const server = await onboarded();
    await expect(login(server, 'cookie', { email: ' ADMIN@Example.com ', password: E2E_ADMIN.password })).resolves
      .toMatchObject({ authToken: expect.any(String) });
  });

  it('AC-AUTH-003.5: every refused login answers the same 401, with its own reason in the audit log', async () => {
    const server = await onboarded();
    withDatabase(server, sqlite => {
      const insert = sqlite.prepare(
        `INSERT INTO users (email, display_name, role, login_method, password_hash, created_at, disabled)
         VALUES (?, 'Someone', 'user', ?, ?, 0, ?)`
      );
      const hash = (sqlite.prepare('SELECT password_hash AS hash FROM users').get() as { hash: string; }).hash;
      insert.run('oidc@example.com', 'oidc', null, 0);
      insert.run('invited@example.com', 'password', null, 0);
      insert.run('disabled@example.com', 'password', hash, 1);
    });
    const attempts = [
      { email: 'nobody@example.com', password: E2E_ADMIN.password },
      { email: E2E_ADMIN.email, password: 'wrong horse 1' },
      { email: 'oidc@example.com', password: E2E_ADMIN.password },
      { email: 'invited@example.com', password: E2E_ADMIN.password },
      { email: 'disabled@example.com', password: E2E_ADMIN.password }
    ];

    const answers = [];
    for (const attempt of attempts) {
      const response = await postJson(server, LOGIN, attempt);
      const headers: Record<string, string> = {};
      response.headers.forEach((value, name) => {
        if (![ 'x-request-id', 'etag', 'date' ].includes(name)) {
          headers[name] = value;
        }
      });
      const body = (await response.json()) as Record<string, unknown>;
      delete body['requestId'];
      answers.push({ status: response.status, body, headers });
    }

    expect(answers[0]).toMatchObject({
      status: 401,
      body: { code: 'wrong-credentials', message: 'Wrong username or password' }
    });
    for (const answer of answers) {
      expect(answer).toEqual(answers[0]);
    }
    expect(auditReasons(server)).toEqual([
      'unknown-email',
      'wrong-password',
      'not-password-user',
      'onboarding-not-finished',
      'user-disabled'
    ]);
  });

  it('AC-AUTH-003.6: body delivery returns the refresh token in the body and sets no cookie', async () => {
    const server = await onboarded();
    const { response, refreshToken } = await login(server, 'body');
    expect(refreshToken).toMatch(/^[\w-]+\.[\w-]+$/);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it('AC-AUTH-003.10: an auth token is refused after FRONT_BURNER_AUTH_TOKEN_TTL', async () => {
    const server = await onboarded({ FRONT_BURNER_AUTH_TOKEN_TTL: '2s' });
    const { authToken } = await login(server);
    expect((await me(server, authToken)).status).toBe(200);

    await new Promise(resolve => setTimeout(resolve, 3_000));

    const expired = await me(server, authToken);
    expect(expired.status).toBe(401);
    expect(await codeOf(expired)).toBe('auth-token-expired');
  });

  it('AC-AUTH-003.12: reusing a rotated refresh token revokes the session', async () => {
    const server = await onboarded();
    const first = await login(server, 'body');
    const rotated = await postJson(server, REFRESH, { refreshToken: first.refreshToken });
    expect(rotated.status).toBe(200);
    const newest = (await rotated.json()) as { authToken: string; refreshToken: string; };

    const reused = await postJson(server, REFRESH, { refreshToken: first.refreshToken });
    expect(reused.status).toBe(401);
    expect(await codeOf(reused)).toBe('refresh-refused');

    expect((await postJson(server, REFRESH, { refreshToken: newest.refreshToken })).status).toBe(401);
    const refused = await me(server, newest.authToken);
    expect(refused.status).toBe(401);
    expect(await codeOf(refused)).toBe('unauthenticated');
    expect(auditReasons(server)).toContain('refresh-token-reused');
  });

  it('AC-AUTH-003.25: no login audit entry contains a password or token', async () => {
    const server = await onboarded();
    const wrongPassword = 'wrong horse 1';
    expect((await postJson(server, LOGIN, { email: E2E_ADMIN.email, password: wrongPassword })).status).toBe(401);
    const first = await login(server, 'body');
    const rotated = (await (await postJson(server, REFRESH, { refreshToken: first.refreshToken })).json()) as {
      authToken: string;
      refreshToken: string;
    };
    expect((await postJson(server, REFRESH, { refreshToken: first.refreshToken })).status).toBe(401);

    const entries = JSON.stringify(withDatabase(server, sqlite => sqlite.prepare('SELECT * FROM login_audit').all()));
    expect(auditReasons(server)).toEqual([ 'wrong-password', 'success', 'refresh-token-reused' ]);
    for (
      const secret of [
        E2E_ADMIN.password,
        wrongPassword,
        first.authToken,
        first.refreshToken,
        rotated.authToken,
        rotated.refreshToken
      ]
    ) {
      expect(entries).not.toContain(secret);
    }
  });

  it('AC-AUTH-002.14: a stored password that does not meet the policy still logs in', async () => {
    const server = await onboarded();
    const weak = 'abc';
    const weakHash = await hash(weak, { type: argon2id });
    withDatabase(
      server,
      sqlite => sqlite.prepare('UPDATE users SET password_hash = ? WHERE email = ?').run(weakHash, E2E_ADMIN.email)
    );

    await expect(login(server, 'body', { email: E2E_ADMIN.email, password: weak })).resolves.toMatchObject({
      authToken: expect.any(String)
    });
  });

  it('AC-AUTH-003.13: a cookie refresh without the header, or from another origin, is refused', async () => {
    const server = await onboarded();
    const { refreshToken } = await login(server);

    const withoutHeader = await postJson(server, REFRESH, {}, { cookie: `front_burner_refresh=${refreshToken}` });
    expect(withoutHeader.status).toBe(403);
    expect(await codeOf(withoutHeader)).toBe('cross-site-refused');

    const otherOrigin = await postJson(server, REFRESH, {}, {
      ...COOKIE_HEADERS(refreshToken),
      origin: 'https://evil.example'
    });
    expect(otherOrigin.status).toBe(403);

    const sameSite = await postJson(server, REFRESH, {}, { ...COOKIE_HEADERS(refreshToken), origin: server.url });
    expect(sameSite.status).toBe(200);
    expect(refreshCookieOf(sameSite)).not.toBe(refreshToken);
  });

  it('AC-AUTH-003.15: after logout both tokens are refused and the cookie is cleared, even with an expired auth token', async () => {
    const server = await onboarded({ FRONT_BURNER_AUTH_TOKEN_TTL: '1s' });
    const { authToken, refreshToken } = await login(server);
    await new Promise(resolve => setTimeout(resolve, 2_000));

    const logout = await postJson(server, LOGOUT, {}, {
      ...COOKIE_HEADERS(refreshToken),
      authorization: `Bearer ${authToken}`
    });
    expect(logout.status).toBe(204);
    expect(logout.headers.getSetCookie().join('\n')).toMatch(/^front_burner_refresh=;.*Expires=Thu, 01 Jan 1970/);

    expect((await me(server, authToken)).status).toBe(401);
    const refresh = await postJson(server, REFRESH, {}, COOKIE_HEADERS(refreshToken));
    expect(refresh.status).toBe(401);
  });

  it('AC-AUTH-003.15: after logout an unexpired auth token is refused too', async () => {
    const server = await onboarded();
    const { authToken, refreshToken } = await login(server, 'body');
    expect((await postJson(server, LOGOUT, { refreshToken })).status).toBe(204);

    const refused = await me(server, authToken);
    expect(refused.status).toBe(401);
    expect(await codeOf(refused)).toBe('unauthenticated');
  });

  it('AC-AUTH-003.17: the backend does not start without FRONT_BURNER_JWT_SECRET or with a short one', async () => {
    for (const secret of [ '', 'x'.repeat(31) ]) {
      const { code, output } = await runServerToExit({ FRONT_BURNER_JWT_SECRET: secret });
      expect(code).not.toBe(0);
      expect(output).toContain('FRONT_BURNER_JWT_SECRET');
      if (secret !== '') {
        expect(output).not.toContain(secret);
      }
    }
  });

  it('AC-AUTH-003.24: too many logins get 429, for known and unknown emails alike', async () => {
    const server = await onboarded();
    for (let i = 0; i < 10; i++) {
      const email = i % 2 === 0 ? E2E_ADMIN.email : 'nobody@example.com';
      await postJson(server, LOGIN, { email, password: 'wrong horse 1' });
    }

    const known = await postJson(server, LOGIN, E2E_ADMIN);
    const unknown = await postJson(server, LOGIN, { email: 'nobody@example.com', password: 'x' });
    expect(known.status).toBe(429);
    expect(unknown.status).toBe(429);
    expect(auditReasons(server).slice(-2)).toEqual([ 'rate-limited', 'rate-limited' ]);
  });

  it('a restart keeps the session', async () => {
    const dataDir = ownDataDir();
    const first = await onboarded({ FRONT_BURNER_DATA_DIR: dataDir });
    const { refreshToken } = await login(first, 'body');
    await first.stop();

    const second = await start({ FRONT_BURNER_DATA_DIR: dataDir });
    const refreshed = await postJson(second, REFRESH, { refreshToken });
    expect(refreshed.status).toBe(200);
    const { authToken } = (await refreshed.json()) as { authToken: string; };
    expect((await me(second, authToken)).status).toBe(200);
  });

  it('LG-64: a new JWT secret makes old auth tokens expire but keeps the session', async () => {
    const dataDir = ownDataDir();
    const first = await onboarded({ FRONT_BURNER_DATA_DIR: dataDir });
    const { authToken, refreshToken } = await login(first, 'body');
    await first.stop();

    const second = await start({
      FRONT_BURNER_DATA_DIR: dataDir,
      FRONT_BURNER_JWT_SECRET: 'a-completely-different-jwt-secret-0123456789abc'
    });
    const old = await me(second, authToken);
    expect(old.status).toBe(401);
    expect(await codeOf(old)).toBe('auth-token-expired');

    const refreshed = await postJson(second, REFRESH, { refreshToken });
    expect(refreshed.status).toBe(200);
    const fresh = (await refreshed.json()) as { authToken: string; };
    expect((await me(second, fresh.authToken)).status).toBe(200);
  });
});
