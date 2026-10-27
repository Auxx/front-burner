import { Config, ConfigModule } from '@front-burner/server-core-config';
import { CryptoModule } from '@front-burner/server-core-crypto';
import { Database, DatabaseModule, loginAudit, NewUser, users } from '@front-burner/server-core-database';
import { EventsModule } from '@front-burner/server-core-events';
import { JobsModule } from '@front-burner/server-core-jobs';
import { ApiExceptionFilter } from '@front-burner/server-core-observability';
import {
  EgressHttpClient,
  EgressModule,
  RateLimitModule,
  SessionLifecycleModule
} from '@front-burner/server-core-security';
import { INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import request from 'supertest';
import { AuthModule } from '../auth.module';
import { PasswordHasher } from '../passwords/password-hasher';
import { MockOidcProvider, startMockOidcProvider } from '../testing/mock-oidc-provider';
import { createTestDatabase } from '../testing/test-database';

const PASSWORD = 'correct horse 1';
const LOGIN = '/api/v1/auth/login';
const REFRESH = '/api/v1/auth/session/refresh';
const LOGOUT = '/api/v1/auth/session/logout';
const config = {
  setupToken: undefined,
  jwtSecret: 'auth-controller-spec-secret-0123456789abcdefghi',
  encryptionKey: 'auth-controller-spec-encryption-key-0123456789',
  blockPrivateNetworks: false,
  authTokenTtlMs: 15 * 60_000,
  refreshTokenTtlMs: 30 * 86_400_000
} as Config;

const without = (value: Record<string, unknown>, keys: string[]) =>
  Object.fromEntries(Object.entries(value).filter(([ key ]) => !keys.includes(key)));

describe('AuthController', () => {
  let passwordHash: string;
  let app: INestApplication;
  let database: Database;

  const http = () => request(app.getHttpServer());
  const addUser = (user: Partial<NewUser> & { email: string; }) =>
    database.db.insert(users).values({
      displayName: 'Alice',
      role: 'administrator',
      loginMethod: 'password',
      passwordHash,
      createdAt: new Date(0),
      ...user
    }).returning().get();
  const login = (body: object = {}) => http().post(LOGIN).send({ email: 'alice@x.io', password: PASSWORD, ...body });
  const refreshCookieOf = (response: request.Response) => {
    const cookie = ([] as string[]).concat(response.headers['set-cookie'] ?? [])[0] ?? '';
    return /^front_burner_refresh=([^;]*)/.exec(cookie)?.[1] ?? '';
  };

  beforeAll(async () => {
    passwordHash = await new PasswordHasher().hash(PASSWORD);
  });

  async function start(withConfig: Config = config, ca?: string): Promise<void> {
    database = createTestDatabase();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(withConfig),
        DatabaseModule.forRoot(database),
        CryptoModule.forRoot(withConfig),
        EgressModule,
        RateLimitModule,
        EventsModule,
        SessionLifecycleModule,
        JobsModule,
        AuthModule
      ],
      providers: [
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor }
      ]
    }).overrideProvider(EgressHttpClient).useFactory({ factory: () => new EgressHttpClient(withConfig, { ca }) })
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    await app.init();
  }

  beforeEach(async () => {
    await start();
  });

  afterEach(async () => {
    await app.close();
    database.sqlite.close();
  });

  it('answers the login methods', async () => {
    const response = await http().get('/api/v1/auth/methods');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ oidc: 'not-configured', passwordReset: false });
  });

  it('says OIDC is available once the provider is discovered', async () => {
    let provider: MockOidcProvider | undefined = await startMockOidcProvider();
    try {
      await app.close();
      database.sqlite.close();
      const oidc = {
        issuer: provider.issuer,
        clientId: 'front-burner',
        clientSecret: 'client-secret',
        scopes: 'openid email profile',
        requireVerifiedEmail: true,
        adminEmail: 'admin@example.com'
      };
      await start({ ...config, oidc }, provider.ca);
      expect((await http().get('/api/v1/auth/methods')).body).toEqual({ oidc: 'available', passwordReset: false });

      await provider.stop();
      provider = undefined;
      await app.close();
      database.sqlite.close();
      await start({ ...config, oidc }, undefined);
      expect((await http().get('/api/v1/auth/methods')).body).toEqual({ oidc: 'unavailable', passwordReset: false });
    } finally {
      await provider?.stop();
    }
  });

  it('logs in with a cookie', async () => {
    addUser({ email: 'alice@x.io' });
    const response = await login();

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      authToken: expect.any(String),
      authTokenExpiresAt: expect.any(String),
      refreshTokenExpiresAt: expect.any(String)
    });
    const cookie = String(response.headers['set-cookie']);
    expect(cookie).toMatch(/^front_burner_refresh=[\w-]+\.[\w-]+;/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/api/v1/auth/session');
    expect(cookie).toContain(`Expires=${new Date(response.body.refreshTokenExpiresAt).toUTCString()}`);
  });

  it('logs in with body delivery', async () => {
    addUser({ email: 'alice@x.io' });
    const response = await login({ refreshTokenDelivery: 'body' });

    expect(response.status).toBe(200);
    expect(response.body.refreshToken).toMatch(/^[\w-]+\.[\w-]+$/);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('refreshes from the cookie with the header', async () => {
    addUser({ email: 'alice@x.io' });
    const token = refreshCookieOf(await login());

    const response = await http().post(REFRESH).set('Cookie', `front_burner_refresh=${token}`)
      .set('X-Front-Burner-Refresh', '1').send({});

    expect(response.status).toBe(200);
    expect(response.body.refreshToken).toBeUndefined();
    const rotated = refreshCookieOf(response);
    expect(rotated).not.toBe('');
    expect(rotated).not.toBe(token);
  });

  it('refreshes from the body for body delivery', async () => {
    addUser({ email: 'alice@x.io' });
    const { refreshToken } = (await login({ refreshTokenDelivery: 'body' })).body;

    const response = await http().post(REFRESH).send({ refreshToken });

    expect(response.status).toBe(200);
    expect(response.body.refreshToken).toMatch(/^[\w-]+\.[\w-]+$/);
    expect(response.body.refreshToken).not.toBe(refreshToken);
  });

  it('allows the same origin', async () => {
    addUser({ email: 'alice@x.io' });
    const token = refreshCookieOf(await login());
    const response = await http().post(REFRESH).set('Cookie', `front_burner_refresh=${token}`)
      .set('X-Front-Burner-Refresh', '1').set('Host', 'notes.example:8080').set('Origin', 'http://notes.example:8080')
      .send({});
    expect(response.status).toBe(200);
  });

  it('refuses the cookie without the header', async () => {
    addUser({ email: 'alice@x.io' });
    const token = refreshCookieOf(await login());

    const response = await http().post(REFRESH).set('Cookie', `front_burner_refresh=${token}`).send({});
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('cross-site-refused');
  });

  it('refuses another origin', async () => {
    addUser({ email: 'alice@x.io' });
    const token = refreshCookieOf(await login());

    const response = await http().post(REFRESH).set('Cookie', `front_burner_refresh=${token}`)
      .set('X-Front-Burner-Refresh', '1').set('Origin', 'https://evil.example').send({});
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('cross-site-refused');
  });

  it('refuses a token in both cookie and body', async () => {
    addUser({ email: 'alice@x.io' });
    const token = refreshCookieOf(await login());

    const response = await http().post(REFRESH).set('Cookie', `front_burner_refresh=${token}`)
      .set('X-Front-Burner-Refresh', '1').send({ refreshToken: token });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('malformed-request');
  });

  it('refuses a refresh without a token', async () => {
    const response = await http().post(REFRESH).send({});
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('refresh-refused');
  });

  it('logs out and clears the cookie, even with an expired auth token', async () => {
    addUser({ email: 'alice@x.io' });
    const token = refreshCookieOf(await login());

    const response = await http().post(LOGOUT).set('Cookie', `front_burner_refresh=${token}`)
      .set('X-Front-Burner-Refresh', '1').set('Authorization', 'Bearer expired.or.garbage').send({});

    expect(response.status).toBe(204);
    const cleared = String(response.headers['set-cookie']);
    expect(cleared).toMatch(/^front_burner_refresh=;/);
    expect(cleared).toContain('Path=/api/v1/auth/session');
    expect(cleared).toContain('Expires=Thu, 01 Jan 1970');

    const again = await http().post(REFRESH).set('Cookie', `front_burner_refresh=${token}`)
      .set('X-Front-Burner-Refresh', '1').send({});
    expect(again.status).toBe(401);
  });

  it('answers 401 wrong-credentials identically for every failure', async () => {
    addUser({ email: 'alice@x.io' });
    addUser({ email: 'oidc@x.io', loginMethod: 'oidc', passwordHash: null });
    addUser({ email: 'invited@x.io', passwordHash: null });
    addUser({ email: 'disabled@x.io', disabled: true });
    const attempts = [
      { email: 'nobody@x.io' },
      { email: 'alice@x.io', password: 'wrong horse 1' },
      { email: 'oidc@x.io' },
      { email: 'invited@x.io' },
      { email: 'disabled@x.io' }
    ];

    const answers = [];
    for (const attempt of attempts) {
      const response = await login(attempt);
      answers.push({
        status: response.status,
        body: without(response.body, [ 'requestId' ]),
        headers: without(response.headers, [ 'x-request-id', 'etag', 'date' ])
      });
    }

    expect(answers[0]?.status).toBe(401);
    expect(answers[0]?.body).toEqual({ code: 'wrong-credentials', params: {}, message: 'Wrong username or password' });
    for (const answer of answers) {
      expect(answer).toEqual(answers[0]);
    }
    expect(database.db.select().from(loginAudit).all().map(entry => entry.reason)).toEqual([
      'unknown-email',
      'wrong-password',
      'not-password-user',
      'onboarding-not-finished',
      'user-disabled'
    ]);
  });

  it('records a rate-limited login', async () => {
    addUser({ email: 'alice@x.io' });
    for (let i = 0; i < 10; i++) {
      await login({ password: 'wrong horse 1' });
    }

    const response = await login();

    expect(response.status).toBe(429);
    expect(response.body.code).toBe('rate-limited');
    expect(database.db.select().from(loginAudit).all().reverse()[0]).toMatchObject({
      method: 'password',
      outcome: 'failure',
      reason: 'rate-limited',
      email: 'alice@x.io'
    });
  });

  it('returns the current user', async () => {
    const alice = addUser({ email: 'alice@x.io' });
    const { authToken } = (await login()).body;

    const response = await http().get('/api/v1/me').set('Authorization', `Bearer ${authToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: alice.id, email: 'alice@x.io', displayName: 'Alice', role: 'administrator' });
  });

  it('refuses me without a token', async () => {
    const response = await http().get('/api/v1/me');
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('unauthenticated');
  });
});
