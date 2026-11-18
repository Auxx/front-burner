import { Config } from '@front-burner/server-core-config';
import { ApiErrorSchema } from '@front-burner/shared-contracts';
import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ThrottlerException } from '@nestjs/throttler';
import { createZodDto, ZodValidationPipe } from 'nestjs-zod';
import { Writable } from 'node:stream';
import request from 'supertest';
import { z } from 'zod';
import { createRequestLogger, LoggingModule } from '../logging/logging.module';
import { ApiErrorException } from './api-error.exception';
import { ApiExceptionFilter } from './api-exception.filter';

class SignupDto extends createZodDto(z.object({ email: z.string(), age: z.number().min(18).optional() })) {}

@Controller('test')
class TestController {
  @Get('api-error')
  apiError() {
    throw new ApiErrorException(409, 'some-code', { a: 1 });
  }

  @Get('low-storage')
  lowStorage() {
    throw new ApiErrorException(507, 'low-storage');
  }

  @Get('sqlite-full')
  sqliteFull() {
    throw Object.assign(new Error('database or disk is full'), { code: 'SQLITE_FULL' });
  }

  @Get('remote-failed')
  remoteFailed() {
    throw new ApiErrorException(502, 'remote-failed');
  }

  @Get('fields')
  fields() {
    throw ApiErrorException.forFields([ { path: 'issuer', code: 'oidc-issuer-unreachable', params: { host: 'x' } } ]);
  }

  @Get('throttled')
  throttled() {
    throw new ThrottlerException();
  }

  @Get('bad')
  bad() {
    throw new BadRequestException('nope');
  }

  @Get('boom')
  boom() {
    throw new Error('secret internal detail');
  }

  @Post('signup')
  signup(@Body(new ZodValidationPipe(SignupDto)) _body: SignupDto) {
    return { ok: true };
  }
}

const config: Config = {
  version: '0.0.0',
  port: 3000,
  trustedProxies: [],
  logLevel: 'error',
  logFormat: 'json',
  dataDir: '/tmp',
  reposRoot: '/tmp',
  setupToken: undefined,
  jwtSecret: 'spec-jwt-secret-0123456789abcdefghijklmnopqrstu',
  encryptionKey: 'spec-encryption-key-0123456789abcdefghijklmnop',
  encryptionKeyReset: false,
  blockPrivateNetworks: false,
  authTokenTtlMs: 900_000,
  refreshTokenTtlMs: 2_592_000_000,
  loginAuditRetentionMs: 7_776_000_000,
  cloneTimeoutMs: 1_800_000,
  cloneConcurrency: 2,
  gitTimeoutMs: 300_000,
  keyUnlockIdleMs: 3_600_000,
  dbSnapshotIntervalMs: 86_400_000,
  dbSnapshotKeep: 7,
  lowDiskThresholdBytes: 2_147_483_648,
  knownHostsFile: undefined,
  oidc: undefined,
  oidcRequiredClaim: undefined,
  metricsToken: undefined
};

describe('ApiExceptionFilter', () => {
  let app: NestExpressApplication;
  /** The log's JSON lines, at `error` and above (the config's level). */
  const logLines: string[] = [];
  const unhandledLogged = () => logLines.some(line => line.includes('Unhandled exception'));

  beforeAll(async () => {
    const requestLogger = createRequestLogger(
      config,
      new Writable({
        write: (chunk: Buffer, _e, done) => {
          logLines.push(chunk.toString());
          done();
        }
      })
    );
    const moduleRef = await Test.createTestingModule({
      imports: [ LoggingModule.forRoot(requestLogger) ],
      controllers: [ TestController ],
      providers: [ { provide: APP_FILTER, useClass: ApiExceptionFilter } ]
    }).compile();
    // Nest's default JSON limit is 100kb; shrink it to test 413 cheaply.
    app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true, bodyParser: false });
    app.use(requestLogger);
    app.useBodyParser('json', { limit: '1kb' });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers field errors thrown by a service', async () => {
    const response = await request(app.getHttpServer()).get('/test/fields');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      code: 'validation-failed',
      params: {},
      requestId: expect.any(String),
      message: 'The request is invalid.',
      fields: [ { path: 'issuer', code: 'oidc-issuer-unreachable', params: { host: 'x' } } ]
    });
    expect(ApiErrorSchema.safeParse(response.body).success).toBe(true);
  });

  it('answers an unknown route with 404 not-found and the request ID', async () => {
    const res = await request(app.getHttpServer()).get('/nope');

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not-found');
    expect(res.headers['x-request-id']).toBeTruthy();
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
    expect(ApiErrorSchema.safeParse(res.body).success).toBe(true);
  });

  it('keeps the status, code and params of an ApiErrorException', async () => {
    const res = await request(app.getHttpServer()).get('/test/api-error');

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'some-code', params: { a: 1 } });
    expect(ApiErrorSchema.safeParse(res.body).success).toBe(true);
  });

  it('answers a validation failure with 400 and fields, without the input', async () => {
    const res = await request(app.getHttpServer()).post('/test/signup').send({ email: 1, age: 3 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation-failed');
    expect(res.body.fields[0].path).toBe('email');
    expect(res.body.fields[0].code).toBe('invalid-type');
    expect(res.body.fields.map((f: { path: string; }) => f.path)).toContain('age');
    expect(JSON.stringify(res.body)).not.toMatch(/"input"/);
    expect(ApiErrorSchema.safeParse(res.body).success).toBe(true);
  });

  it('answers malformed JSON with 400 malformed-request', async () => {
    const res = await request(app.getHttpServer())
      .post('/test/signup')
      .set('Content-Type', 'application/json')
      .send('{ not json');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('malformed-request');
    expect(ApiErrorSchema.safeParse(res.body).success).toBe(true);
  });

  it('answers a thrown Error with 500 internal and hides its message', async () => {
    const res = await request(app.getHttpServer()).get('/test/boom');

    expect(res.status).toBe(500);
    expect(res.body.code).toBe('internal');
    expect(JSON.stringify(res.body)).not.toContain('secret internal detail');
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
    expect(ApiErrorSchema.safeParse(res.body).success).toBe(true);
  });

  it('logs a thrown Error at error as unhandled', async () => {
    logLines.length = 0;
    await request(app.getHttpServer()).get('/test/boom');
    expect(unhandledLogged()).toBe(true);
  });

  it('logs another 5xx ApiErrorException as unhandled', async () => {
    logLines.length = 0;
    const res = await request(app.getHttpServer()).get('/test/remote-failed');
    expect(res.status).toBe(502);
    expect(unhandledLogged()).toBe(true);
  });

  it('answers 507 low-storage without logging an unhandled exception, as the disk monitor logs the state', async () => {
    logLines.length = 0;
    const res = await request(app.getHttpServer()).get('/test/low-storage');

    expect(res.status).toBe(507);
    expect(res.body).toMatchObject({
      code: 'low-storage',
      message: 'The server is running low on storage. Contact your administrator.'
    });
    expect(unhandledLogged()).toBe(false);
  });

  it('answers a write the full disk stopped, such as SQLite\'s, with 507 storage-full and logs no unhandled exception (NF-9.8)', async () => {
    logLines.length = 0;
    const res = await request(app.getHttpServer()).get('/test/sqlite-full');

    expect(res.status).toBe(507);
    expect(res.body).toMatchObject({ code: 'storage-full' });
    expect(JSON.stringify(res.body)).not.toContain('database or disk is full');
    expect(unhandledLogged()).toBe(false);
  });

  it('answers ThrottlerException with 429 rate-limited', async () => {
    const res = await request(app.getHttpServer()).get('/test/throttled');

    expect(res.status).toBe(429);
    expect(res.body.code).toBe('rate-limited');
    expect(ApiErrorSchema.safeParse(res.body).success).toBe(true);
  });

  it('answers another client HttpException with 400 malformed-request', async () => {
    const res = await request(app.getHttpServer()).get('/test/bad');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('malformed-request');
  });

  it('answers an oversized body with 413 payload-too-large', async () => {
    const res = await request(app.getHttpServer()).post('/test/signup').send({ email: 'x'.repeat(2048) });

    expect(res.status).toBe(413);
    expect(res.body.code).toBe('payload-too-large');
    expect(ApiErrorSchema.safeParse(res.body).success).toBe(true);
  });
});
