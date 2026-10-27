import { TEST_CERTIFICATE_FILES } from '@front-burner/server-core-security/testing';
import { type MockOidcProvider, startMockOidcProvider } from '@front-burner/server-feature-auth/testing';
import BetterSqlite3 from 'better-sqlite3';
import { join } from 'node:path';
import { Agent, fetch as fetchTrusting } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  E2E_ADMIN,
  E2E_SETUP_TOKEN,
  postJson,
  refreshCookieOf,
  runServerToExit,
  type ServerProcess,
  startServerProcess
} from './support/server-process';

const ADMIN_EMAIL = 'admin@example.com';

interface AuditRow {
  reason: string;
  outcome: string;
  email: string | null;
  provider_error: string | null;
  subject: string | null;
}

describe('OIDC from the environment', () => {
  let provider: MockOidcProvider | undefined;
  let server: ServerProcess | undefined;
  let browser: Agent;

  const oidcEnv = (overrides: Record<string, string> = {}) => ({
    FRONT_BURNER_OIDC_ISSUER: provider?.issuer ?? '',
    FRONT_BURNER_OIDC_CLIENT_ID: 'front-burner',
    FRONT_BURNER_OIDC_CLIENT_SECRET: 'e2e-client-secret',
    FRONT_BURNER_ADMIN_EMAIL: ADMIN_EMAIL,
    FRONT_BURNER_SETUP_TOKEN: E2E_SETUP_TOKEN,
    ...overrides
  });
  const start = async (overrides: Record<string, string> = {}) => {
    server = await startServerProcess(oidcEnv(overrides), { extraCaFile: TEST_CERTIFICATE_FILES.cert });
    return server;
  };
  const withDatabase = <T>(use: (sqlite: BetterSqlite3.Database) => T): T => {
    const sqlite = new BetterSqlite3(join(server?.dataDir ?? '', 'db', 'front-burner.sqlite'));
    try {
      return use(sqlite);
    } finally {
      sqlite.close();
    }
  };
  const audit = () =>
    withDatabase(sqlite =>
      sqlite.prepare('SELECT reason, outcome, email, provider_error, subject FROM login_audit ORDER BY id')
        .all() as AuditRow[]
    );
  const userRows = () =>
    withDatabase(sqlite =>
      sqlite.prepare('SELECT email, role, login_method, oidc_subject FROM users ORDER BY id').all() as Record<
        string,
        unknown
      >[]
    );

  /** start → provider → callback, as a browser would; every `Location` on the way, the last one first. */
  async function throughProvider(): Promise<{ location: string; locations: string[]; cookie: string; }> {
    const url = server?.url ?? '';
    const started = await fetch(`${url}/api/v1/auth/oidc/start`, { redirect: 'manual' });
    const cookie = started.headers.getSetCookie()[0]?.split(';')[0] ?? '';
    const authorized = await fetchTrusting(started.headers.get('location') ?? '', {
      redirect: 'manual',
      dispatcher: browser
    });
    const callback = new URL(authorized.headers.get('location') ?? '');
    const back = await fetch(`${url}${callback.pathname}${callback.search}`, {
      redirect: 'manual',
      headers: { cookie }
    });
    const locations = [ started, authorized, back ].map(response => response.headers.get('location') ?? '');
    // After a success the cookie binds the one-time code to this "browser".
    return { location: locations[2] ?? '', locations, cookie: back.headers.getSetCookie()[0]?.split(';')[0] ?? '' };
  }

  async function logIn(): Promise<{ location: string; locations: string[]; tokens: Response; }> {
    const result = await throughProvider();
    const code = new URL(result.location, 'http://x').searchParams.get('code') ?? '';
    const tokens = await postJson(server as ServerProcess, '/api/v1/auth/oidc/exchange', { code }, {
      cookie: result.cookie
    });
    return { ...result, tokens };
  }

  beforeEach(async () => {
    provider = await startMockOidcProvider();
    browser = new Agent({ connect: { ca: provider.ca } });
  });

  afterEach(async () => {
    await server?.stop();
    server = undefined;
    await provider?.stop();
    provider = undefined;
    await browser.close();
  });

  it('REQ-AUTH-001 criterion 11: the first OIDC login with the admin email creates the administrator', async () => {
    await start();
    const state = await (await fetch(`${server?.url}/api/v1/onboarding`)).json();
    expect(state).toEqual({ state: 'oidc-pending', oidcFromEnvironment: true, setupTokenConfigured: true });

    const setup = await postJson(server as ServerProcess, '/api/v1/onboarding/password-setup', {
      setupToken: E2E_SETUP_TOKEN,
      ...E2E_ADMIN
    });
    expect(setup.status).toBe(404);
    expect(await setup.json()).toMatchObject({ code: 'not-found' });

    const { tokens } = await logIn();
    expect(tokens.status).toBe(200);
    expect(userRows()).toEqual([
      { email: ADMIN_EMAIL, role: 'administrator', login_method: 'oidc', oidc_subject: 'subject-1' }
    ]);
    expect(await (await fetch(`${server?.url}/api/v1/onboarding`)).json()).toMatchObject({ code: 'not-found' });
  });

  it('REQ-AUTH-001 criterion 12: refuses to start with some OIDC variables and names the missing ones', async () => {
    const { code, output } = await runServerToExit({ FRONT_BURNER_OIDC_ISSUER: 'https://id.example.com' });
    expect(code).not.toBe(0);
    for (
      const variable of [ 'FRONT_BURNER_OIDC_CLIENT_ID', 'FRONT_BURNER_OIDC_CLIENT_SECRET', 'FRONT_BURNER_ADMIN_EMAIL' ]
    ) {
      expect(output).toContain(variable);
    }
  });

  it('REQ-AUTH-001 criterion 8: refuses another email while pending and creates no account', async () => {
    await start();
    provider?.setClaims({ email: 'eve@example.com' });

    expect((await throughProvider()).location).toBe('/login?oidcError=admin-email-mismatch');
    expect(userRows()).toEqual([]);
    expect(audit().map(row => row.reason)).toEqual([ 'admin-email-mismatch' ]);
  });

  it('REQ-AUTH-001 criterion 9: refuses an unverified email when required, accepts it when not', async () => {
    await start();
    provider?.setClaims({ email_verified: false });
    expect((await throughProvider()).location).toBe('/login?oidcError=email-not-verified');
    await server?.stop();

    await start({ FRONT_BURNER_OIDC_REQUIRE_VERIFIED_EMAIL: 'false' });
    expect((await throughProvider()).location).toMatch(/^\/login\/oidc\?code=/);
  });

  it('REQ-AUTH-003 criterion 2: offers OIDC while the provider answers', async () => {
    await start();
    expect(await (await fetch(`${server?.url}/api/v1/auth/methods`)).json()).toEqual({
      oidc: 'available',
      passwordReset: false
    });
    await server?.stop();
    await provider?.stop();
    provider = undefined;

    server = await startServerProcess(oidcEnv({ FRONT_BURNER_OIDC_ISSUER: 'https://localhost:1' }), {
      extraCaFile: TEST_CERTIFICATE_FILES.cert
    });
    expect(await (await fetch(`${server.url}/api/v1/auth/methods`)).json()).toEqual({
      oidc: 'unavailable',
      passwordReset: false
    });
  });

  it('the backend starts when the provider is down (AO-32)', async () => {
    const issuer = provider?.issuer ?? '';
    await provider?.stop();
    provider = undefined;
    server = await startServerProcess(oidcEnv({ FRONT_BURNER_OIDC_ISSUER: issuer }), {
      extraCaFile: TEST_CERTIFICATE_FILES.cert
    });
    expect((await fetch(`${server.url}/api/health/ready`)).status).toBe(200);
    expect(server.output()).toContain('OIDC provider discovery failed');
  });

  it('REQ-AUTH-003 criterion 7: returns tokens like a password login, with no token in any URL', async () => {
    await start();
    const { locations, tokens } = await logIn();

    expect(tokens.status).toBe(200);
    expect(await tokens.json()).toEqual({
      authToken: expect.any(String),
      authTokenExpiresAt: expect.any(String),
      refreshTokenExpiresAt: expect.any(String)
    });
    expect(refreshCookieOf(tokens)).not.toBe('');
    for (const location of locations) {
      expect(location).not.toMatch(/token|id_token|access_token|refresh/i);
    }
  });

  it('REQ-AUTH-003 criterion 8: cancelled, disabled and unregistered logins fail alike with different reasons', async () => {
    await start();
    expect((await logIn()).tokens.status).toBe(200);

    provider?.failAuthorization('access_denied', 'The user cancelled.');
    const cancelled = await throughProvider();

    withDatabase(sqlite => sqlite.prepare('UPDATE users SET disabled = 1').run());
    const disabled = await throughProvider();

    withDatabase(sqlite => sqlite.prepare('UPDATE users SET disabled = 0').run());
    provider?.setClaims({ sub: 'subject-2', email: 'new@example.com' });
    const unregistered = await throughProvider();

    expect([ cancelled, disabled, unregistered ].map(result => result.location)).toEqual([
      '/login?oidcError=failed',
      '/login?oidcError=failed',
      '/login?oidcError=failed'
    ]);
    const failures = audit().filter(row => row.outcome === 'failure');
    expect(failures.map(row => [ row.reason, row.provider_error ])).toEqual([
      [ 'provider-error', 'access_denied' ],
      [ 'user-disabled', null ],
      [ 'registration-disabled', null ]
    ]);
    const output = server?.output() ?? '';
    for (const text of [ 'provider-error', 'access_denied', 'user-disabled', 'registration-disabled' ]) {
      expect(output).toContain(text);
    }
  });

  it('REQ-AUTH-003 criterion 9: creates an OIDC user only with automatic registration', async () => {
    await start();
    expect((await logIn()).tokens.status).toBe(200);
    provider?.setClaims({ sub: 'subject-2', email: 'new@example.com' });

    expect((await throughProvider()).location).toBe('/login?oidcError=failed');
    expect(userRows()).toHaveLength(1);

    withDatabase(sqlite => sqlite.prepare('UPDATE system_settings SET automatic_registration = 1').run());
    expect((await logIn()).tokens.status).toBe(200);
    expect(userRows()).toEqual([
      expect.objectContaining({ email: ADMIN_EMAIL }),
      { email: 'new@example.com', role: 'user', login_method: 'oidc', oidc_subject: 'subject-2' }
    ]);
  });
});
