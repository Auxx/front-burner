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
  port: 3000,
  trustedProxies: [],
  logLevel: 'error',
  logFormat: 'json',
  dataDir: '/tmp',
  setupToken: undefined,
  jwtSecret: 'spec-jwt-secret-0123456789abcdefghijklmnopqrstu',
  authTokenTtlMs: 900_000,
  refreshTokenTtlMs: 2_592_000_000,
  loginAuditRetentionMs: 7_776_000_000
};

describe('ApiExceptionFilter', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const requestLogger = createRequestLogger(config, new Writable({ write: (_c, _e, done) => done() }));
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
