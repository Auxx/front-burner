import { Config, ConfigModule, OidcEnvironment } from '@front-burner/server-core-config';
import { CryptoModule, SecretBox } from '@front-burner/server-core-crypto';
import {
  Database,
  DatabaseModule,
  instanceState,
  loginAudit,
  systemSettings,
  users
} from '@front-burner/server-core-database';
import { ApiExceptionFilter } from '@front-burner/server-core-observability';
import { EgressHttpClient, EgressModule, RateLimitModule } from '@front-burner/server-core-security';
import { INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import request from 'supertest';
import { AuthModule } from '../auth.module';
import { MockOidcProvider, startMockOidcProvider } from '../testing/mock-oidc-provider';
import { createTestDatabase } from '../testing/test-database';
import { OIDC_CLIENT_SECRET_BINDING } from './oidc-settings.service';

const START = '/api/v1/auth/oidc/start';
const EXCHANGE = '/api/v1/auth/oidc/exchange';
const ENCRYPTION_KEY = 'oidc-controller-spec-encryption-key-0123456789';

describe('OidcController', () => {
  let provider: MockOidcProvider;
  let egress: EgressHttpClient;
  let database: Database;
  let app: INestApplication;

  const http = () => request(app.getHttpServer());
  const oidcEnvironment = (): OidcEnvironment => ({
    issuer: provider.issuer,
    clientId: 'front-burner',
    clientSecret: 'client-secret',
    scopes: 'openid email profile',
    requireVerifiedEmail: true,
    adminEmail: 'admin@example.com'
  });

  /** Starts the app; `prepare` runs on the database before the onboarding state is worked out. */
  async function start(oidc: OidcEnvironment | undefined, prepare: () => void = () => undefined): Promise<void> {
    const config = {
      jwtSecret: 'oidc-controller-spec-jwt-secret-0123456789abcdef',
      encryptionKey: ENCRYPTION_KEY,
      blockPrivateNetworks: false,
      authTokenTtlMs: 15 * 60_000,
      refreshTokenTtlMs: 30 * 86_400_000,
      oidc
    } as Config;
    egress = new EgressHttpClient(config, { ca: provider.ca });
    prepare();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(config),
        DatabaseModule.forRoot(database),
        CryptoModule.forRoot(config),
        EgressModule,
        RateLimitModule,
        AuthModule
      ],
      providers: [
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor }
      ]
    }).overrideProvider(EgressHttpClient).useValue(egress).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    await app.init();
  }

  /** start → provider → callback, as a browser would; returns the callback's response. */
  async function loginThroughProvider(): Promise<request.Response> {
    const started = await http().get(START);
    const cookie = ([] as string[]).concat(started.headers['set-cookie'] ?? [])[0]?.split(';')[0] ?? '';
    const authorized = await egress.fetch(started.headers['location'] as string, { redirect: 'manual' });
    const callback = new URL(authorized.headers.get('location') ?? '');
    return http().get(`${callback.pathname}${callback.search}`).set('Cookie', cookie);
  }
  const codeOf = (response: request.Response) =>
    new URL(response.headers['location'] as string, 'https://x').searchParams.get('code') ?? '';
  const addUser = () =>
    database.db.insert(users).values({
      email: 'root@example.com',
      displayName: 'Root',
      role: 'administrator',
      loginMethod: 'password',
      passwordHash: 'x',
      createdAt: new Date(0)
    }).run();

  beforeEach(async () => {
    provider = await startMockOidcProvider();
    database = createTestDatabase();
  });

  afterEach(async () => {
    await app.close();
    await egress.onModuleDestroy();
    await provider.stop();
    database.sqlite.close();
  });

  it('starts with a state cookie and a PKCE challenge', async () => {
    await start(oidcEnvironment());
    const response = await http().get(START);

    expect(response.status).toBe(302);
    const location = new URL(response.headers['location'] as string);
    expect(location.origin).toBe(provider.issuer);
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('redirect_uri')).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/api\/v1\/auth\/oidc\/callback$/
    );
    const [ cookie ] = ([] as string[]).concat(response.headers['set-cookie'] ?? []);
    expect(cookie).toContain(`front_burner_oidc=${location.searchParams.get('state')}`);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth\/oidc/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Max-Age=600/);
  });

  it('answers start with 404 without OIDC', async () => {
    await start(undefined);
    const response = await http().get(START);
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ code: 'not-found' });
  });

  it('sends a completed login to /login/oidc with a code', async () => {
    await start(oidcEnvironment());
    const response = await loginThroughProvider();

    expect(response.status).toBe(302);
    expect(response.headers['location']).toMatch(/^\/login\/oidc\?code=[\w-]{43}$/);
    expect(([] as string[]).concat(response.headers['set-cookie'] ?? []).join()).toMatch(/front_burner_oidc=;/);
  });

  it('sends a failure to the login page without the reason', async () => {
    await start(oidcEnvironment(), addUser);
    const response = await loginThroughProvider();

    expect(response.status).toBe(302);
    expect(response.headers['location']).toBe('/login?oidcError=failed');
    expect(database.db.select().from(loginAudit).get()?.reason).toBe('registration-disabled');
  });

  it('sends a failure while pending from the environment with the reason', async () => {
    await start(oidcEnvironment());
    provider.setClaims({ email: 'eve@example.com' });
    const response = await loginThroughProvider();

    expect(response.headers['location']).toBe('/login?oidcError=admin-email-mismatch');
  });

  it('sends a failure while pending from the onboarding page back to it', async () => {
    await start(undefined, () => {
      const box = new SecretBox(ENCRYPTION_KEY);
      database.db.insert(systemSettings).values({
        id: 1,
        oidcIssuer: provider.issuer,
        oidcClientId: 'front-burner',
        oidcClientSecret: box.encrypt('client-secret', OIDC_CLIENT_SECRET_BINDING)
      }).run();
      database.db.insert(instanceState).values({
        id: 1,
        onboardingState: 'oidc-pending',
        pendingAdminEmail: 'admin@example.com'
      }).run();
    });
    provider.setClaims({ email_verified: false });
    const response = await loginThroughProvider();

    expect(response.headers['location']).toBe('/onboarding?oidcError=email-not-verified');
  });

  it('refuses a callback without the state cookie', async () => {
    await start(oidcEnvironment());
    const response = await http().get('/api/v1/auth/oidc/callback?code=abc&state=def');
    expect(response.headers['location']).toBe('/login?oidcError=state-mismatch');
  });

  it('exchanges a code for tokens in a cookie', async () => {
    await start(oidcEnvironment());
    const code = codeOf(await loginThroughProvider());
    const response = await http().post(EXCHANGE).send({ code });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      authToken: expect.any(String),
      authTokenExpiresAt: expect.any(String),
      refreshTokenExpiresAt: expect.any(String)
    });
    expect(([] as string[]).concat(response.headers['set-cookie'] ?? []).join()).toMatch(/front_burner_refresh=/);

    const again = await http().post(EXCHANGE).send({ code });
    expect(again.status).toBe(401);
    expect(again.body).toMatchObject({ code: 'oidc-code-invalid' });
  });

  it('puts no token in any redirect', async () => {
    await start(oidcEnvironment());
    const response = await loginThroughProvider();
    const location = response.headers['location'] as string;
    expect(location).not.toMatch(/token|id_token|access/i);
  });
});
