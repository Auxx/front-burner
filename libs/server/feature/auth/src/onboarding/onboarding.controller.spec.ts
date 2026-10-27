import { Config, ConfigModule } from '@front-burner/server-core-config';
import { CryptoModule } from '@front-burner/server-core-crypto';
import { Database, DatabaseModule, users } from '@front-burner/server-core-database';
import { ApiExceptionFilter } from '@front-burner/server-core-observability';
import { EgressHttpClient, EgressModule, RateLimitModule } from '@front-burner/server-core-security';
import { INestApplication, LoggerService } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import request from 'supertest';
import { MockOidcProvider, startMockOidcProvider } from '../testing/mock-oidc-provider';
import { createTestDatabase } from '../testing/test-database';
import { OnboardingModule } from './onboarding.module';

const TOKEN = 'a-setup-token-0123456789';
const PASSWORD = 'correct horse 1';
const EMAIL = 'alice@example.com';

const setup = { setupToken: TOKEN, email: EMAIL, displayName: 'Alice', password: PASSWORD };

/** Collects every log line, at every level, as one string. */
class CollectingLogger implements LoggerService {
  readonly lines: string[] = [];
  log = (...args: unknown[]) => this.collect('log', args);
  error = (...args: unknown[]) => this.collect('error', args);
  warn = (...args: unknown[]) => this.collect('warn', args);
  debug = (...args: unknown[]) => this.collect('debug', args);
  verbose = (...args: unknown[]) => this.collect('verbose', args);

  private collect(level: string, args: unknown[]): void {
    this.lines.push(`${level} ${args.map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ')}`);
  }
}

describe('OnboardingController', () => {
  let app: INestApplication;
  let database: Database;
  let logger: CollectingLogger;
  let provider: MockOidcProvider | undefined;
  let egress: EgressHttpClient | undefined;

  async function start(partial: Partial<Config> = { setupToken: TOKEN }): Promise<void> {
    const config = { encryptionKey: 'onboarding-spec-encryption-key-0123456789', ...partial } as Config;
    database = createTestDatabase();
    logger = new CollectingLogger();
    provider = await startMockOidcProvider();
    egress = new EgressHttpClient({ blockPrivateNetworks: false }, { ca: provider.ca });
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(config),
        DatabaseModule.forRoot(database),
        CryptoModule.forRoot(config),
        EgressModule,
        RateLimitModule,
        OnboardingModule
      ],
      providers: [
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor }
      ]
    }).overrideProvider(EgressHttpClient).useValue(egress).compile();
    app = moduleRef.createNestApplication({ logger });
    app.setGlobalPrefix('api/v1');
    await app.init();
  }

  afterEach(async () => {
    await app.close();
    await provider?.stop();
    await egress?.onModuleDestroy();
  });

  const oidcSetup = () => ({
    setupToken: TOKEN,
    issuer: provider?.issuer,
    clientId: 'front-burner',
    clientSecret: 'a-client-secret-0123',
    adminEmail: 'admin@example.com'
  });

  const http = () => request(app.getHttpServer());

  it('status answers required with setupTokenConfigured', async () => {
    await start();
    const response = await http().get('/api/v1/onboarding');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ state: 'required', oidcFromEnvironment: false, setupTokenConfigured: true });
  });

  it('check answers 204 for the right token and 404 for a wrong one', async () => {
    await start();
    expect((await http().post('/api/v1/onboarding/setup-token/check').send({ setupToken: TOKEN })).status).toBe(
      204
    );
    const wrong = await http().post('/api/v1/onboarding/setup-token/check').send({ setupToken: `${TOKEN}x` });
    expect(wrong.status).toBe(404);
    expect(wrong.body.code).toBe('not-found');
  });

  it('answers 404 before validating the body when the token is wrong', async () => {
    await start();
    for (const body of [ { setupToken: 'wrong' }, {}, { setupToken: 42 } ]) {
      const response = await http().post('/api/v1/onboarding/password-setup').send(body);
      expect(response.status).toBe(404);
      expect(response.body.code).toBe('not-found');
    }
  });

  it('does not trim the setup token', async () => {
    await start();
    const response = await http().post('/api/v1/onboarding/setup-token/check').send({ setupToken: `${TOKEN}\n` });
    expect(response.status).toBe(404);
  });

  it('every data-changing endpoint answers 404 when no token is configured', async () => {
    await start({ setupToken: undefined });
    expect((await http().post('/api/v1/onboarding/setup-token/check').send({ setupToken: TOKEN })).status).toBe(
      404
    );
    expect((await http().post('/api/v1/onboarding/password-setup').send(setup)).status).toBe(404);
    expect((await http().get('/api/v1/onboarding')).body.setupTokenConfigured).toBe(false);
  });

  it('password setup creates one administrator and completes onboarding', async () => {
    await start();
    const response = await http().post('/api/v1/onboarding/password-setup').send(setup);
    expect(response.status).toBe(204);

    const rows = database.db.select().from(users).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      email: EMAIL,
      displayName: 'Alice',
      role: 'administrator',
      loginMethod: 'password'
    });
    expect(rows[0]?.passwordHash).toMatch(/^\$argon2id\$/);

    expect((await http().get('/api/v1/onboarding')).status).toBe(404);
    expect((await http().post('/api/v1/onboarding/setup-token/check').send({ setupToken: TOKEN })).status).toBe(
      404
    );
    expect((await http().post('/api/v1/onboarding/password-setup').send(setup)).status).toBe(404);
  });

  it('a weak password lists every failed rule', async () => {
    await start();
    const response = await http().post('/api/v1/onboarding/password-setup').send({ ...setup, password: 'abc' });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('validation-failed');
    expect(response.body.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'password', code: 'too-short' }),
        expect.objectContaining({ path: 'password', code: 'too-few-classes' })
      ])
    );
    expect(response.text).not.toContain('abc');
    expect(database.db.select().from(users).all()).toHaveLength(0);
  });

  it('refuses a password equal to the email', async () => {
    await start();
    const response = await http()
      .post('/api/v1/onboarding/password-setup')
      .send({ ...setup, password: EMAIL.toUpperCase() });
    expect(response.status).toBe(400);
    expect(response.body.fields).toEqual([ expect.objectContaining({ path: 'password', code: 'equals-email' }) ]);
  });

  it('no secret reaches the log', async () => {
    await start();
    await http().post('/api/v1/onboarding/setup-token/check').send({ setupToken: 'a-wrong-token-0123456789' });
    await http().post('/api/v1/onboarding/setup-token/check').send({ setupToken: TOKEN });
    await http().post('/api/v1/onboarding/password-setup').send(setup);

    const text = logger.lines.join('\n');
    expect(text).toContain('Setup token rejected');
    expect(text).toContain('Administrator onboarding started');
    expect(text).toContain('Administrator onboarding completed');
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain('a-wrong-token-0123456789');
    expect(text).not.toContain(PASSWORD);
    // Not even at debug: the completion line says enough.
    expect(text).not.toContain(EMAIL);
  });

  it('stores the email trimmed, as typed otherwise', async () => {
    await start();
    const response = await http()
      .post('/api/v1/onboarding/password-setup')
      .send({ ...setup, email: '  Alice@Example.com ' });
    expect(response.status).toBe(204);
    expect(database.db.select().from(users).all()[0]?.email).toBe('Alice@Example.com');
  });

  it('answers 404 for a wrong token, before validating the body', async () => {
    await start();
    for (const route of [ 'oidc-setup', 'oidc-setup/current' ]) {
      for (const body of [ { setupToken: 'wrong' }, {}, { ...oidcSetup(), setupToken: `${TOKEN}x` } ]) {
        const response = await http().post(`/api/v1/onboarding/${route}`).send(body);
        expect(response.status).toBe(404);
        expect(response.body.code).toBe('not-found');
      }
    }
  });

  it('answers 404 when OIDC comes from the environment', async () => {
    await start({
      setupToken: TOKEN,
      oidc: {
        issuer: 'https://env.example.com',
        clientId: 'env',
        clientSecret: 'env-secret',
        scopes: 'openid',
        requireVerifiedEmail: true,
        adminEmail: 'admin@example.com'
      }
    });
    expect((await http().post('/api/v1/onboarding/oidc-setup').send(oidcSetup())).status).toBe(404);
    expect((await http().post('/api/v1/onboarding/oidc-setup/current').send({ setupToken: TOKEN })).status).toBe(
      404
    );
  });

  it('saves an OIDC setup and returns it without the secret', async () => {
    await start();
    const current = () => http().post('/api/v1/onboarding/oidc-setup/current').send({ setupToken: TOKEN });
    expect((await current()).status).toBe(404);

    expect((await http().post('/api/v1/onboarding/oidc-setup').send(oidcSetup())).status).toBe(204);
    const response = await current();
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      issuer: provider?.issuer,
      clientId: 'front-burner',
      scopes: 'openid email profile',
      requireVerifiedEmail: true,
      adminEmail: 'admin@example.com',
      hasClientSecret: true
    });
    expect((await http().get('/api/v1/onboarding')).body.state).toBe('oidc-pending');

    const text = logger.lines.join('\n');
    expect(text).toContain('OIDC setup saved');
    expect(text).not.toContain('a-client-secret-0123');
  });

  it('reports a refused issuer on the field', async () => {
    await start();
    const response = await http()
      .post('/api/v1/onboarding/oidc-setup')
      .send({ ...oidcSetup(), issuer: `${provider?.issuer}/` });
    expect(response.status).toBe(400);
    expect(response.body.fields).toEqual([
      { path: 'issuer', code: 'oidc-issuer-mismatch', params: { expected: provider?.issuer } }
    ]);
  });
});
