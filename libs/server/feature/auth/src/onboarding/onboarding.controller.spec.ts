import { Config, ConfigModule } from '@front-burner/server-core-config';
import { Database, DatabaseModule, users } from '@front-burner/server-core-database';
import { ApiExceptionFilter } from '@front-burner/server-core-observability';
import { RateLimitModule } from '@front-burner/server-core-security';
import { INestApplication, LoggerService } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ZodValidationPipe } from 'nestjs-zod';
import request from 'supertest';
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

  async function start(config: Partial<Config> = { setupToken: TOKEN }): Promise<void> {
    database = createTestDatabase();
    logger = new CollectingLogger();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(config as Config),
        DatabaseModule.forRoot(database),
        RateLimitModule,
        OnboardingModule
      ],
      providers: [
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
        { provide: APP_PIPE, useClass: ZodValidationPipe }
      ]
    }).compile();
    app = moduleRef.createNestApplication({ logger });
    app.setGlobalPrefix('api/v1');
    await app.init();
  }

  afterEach(async () => {
    await app.close();
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
    // The email appears at debug only (NF-10.5).
    expect(logger.lines.filter(line => line.includes(EMAIL)).every(line => line.startsWith('debug'))).toBe(true);
  });
});
