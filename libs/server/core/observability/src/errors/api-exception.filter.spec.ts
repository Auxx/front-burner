import { Config } from '@front-burner/server-core-config';
import { ApiErrorSchema } from '@front-burner/shared-contracts';
import { Body, Controller, Get, INestApplication, Post } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { createZodDto, ZodValidationPipe } from 'nestjs-zod';
import request from 'supertest';
import { z } from 'zod';
import { LoggingModule } from '../logging/logging.module';
import { ApiErrorException } from './api-error.exception';
import { ApiExceptionFilter } from './api-exception.filter';

class SignupDto extends createZodDto(z.object({ email: z.string(), age: z.number().min(18).optional() })) {}

@Controller('test')
class TestController {
  @Get('api-error')
  apiError() {
    throw new ApiErrorException(409, 'some-code', { a: 1 });
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
  // The 500 test logs an error on purpose; keep the test output clean.
  logLevel: 'silent' as Config['logLevel'],
  logFormat: 'json',
  dataDir: '/tmp',
  setupToken: undefined
};

describe('ApiExceptionFilter', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ LoggingModule.forRoot(config) ],
      controllers: [ TestController ],
      providers: [ { provide: APP_FILTER, useClass: ApiExceptionFilter } ]
    }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
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
});
