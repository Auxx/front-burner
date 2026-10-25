import { Config } from '@front-burner/server-core-config';
import { Controller, Get, INestApplication, Logger as NestLogger, Res } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import { Writable } from 'node:stream';
import request from 'supertest';
import { ApiExceptionFilter } from '../errors/api-exception.filter';
import { createRequestLogger, LoggingModule } from './logging.module';

@Controller('t')
class LogController {
  @Get('cookie')
  cookie(@Res({ passthrough: true }) res: unknown) {
    (res as { setHeader(n: string, v: string): void; }).setHeader('Set-Cookie', 'sid=secret-cookie-value');
    return { ok: true };
  }

  @Get('log')
  log() {
    new NestLogger('Feature').log('inside request');
    return { ok: true };
  }

  @Get('boom')
  boom() {
    throw new Error('secret internal detail');
  }
}

const config: Config = {
  port: 3000,
  trustedProxies: [],
  logLevel: 'info',
  logFormat: 'json',
  dataDir: '/tmp',
  setupToken: undefined
};

describe('LoggingModule', () => {
  let app: INestApplication;
  let output: string;

  beforeAll(async () => {
    output = '';
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      }
    });
    const requestLogger = createRequestLogger(config, destination);
    const moduleRef = await Test.createTestingModule({
      imports: [ LoggingModule.forRoot(requestLogger) ],
      controllers: [ LogController ],
      providers: [ { provide: APP_FILTER, useClass: ApiExceptionFilter } ]
    }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    app.use(requestLogger);
    app.useLogger(app.get(Logger));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const entries = () => output.split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, any>);

  it('redacts authorization, cookie and set-cookie in the real request and response logs', async () => {
    await request(app.getHttpServer())
      .get('/t/cookie')
      .set('Authorization', 'Bearer secret-token-value')
      .set('Cookie', 'refresh=secret-refresh-value');

    expect(output).toContain('"/t/cookie"');
    expect(output).toContain('"headers"'); // the real req and res were serialised
    expect(output).not.toContain('secret-token-value');
    expect(output).not.toContain('secret-refresh-value');
    expect(output).not.toContain('secret-cookie-value');
  });

  it('logs requestId on the request line and module on Nest logger lines', async () => {
    output = '';
    const res = await request(app.getHttpServer()).get('/t/log');
    const id = res.headers['x-request-id'];

    const completed = entries().find(e => e['message'] === 'request completed');
    expect(completed?.['requestId']).toBe(id);
    const inside = entries().find(e => e['message'] === 'inside request');
    expect(inside?.['module']).toBe('Feature');
    expect(inside?.['requestId']).toBe(id);
  });

  it('logs a thrown Error at error level with its stack but does not leak it', async () => {
    output = '';
    const res = await request(app.getHttpServer()).get('/t/boom');

    const logged = entries().find(e => e['level'] === 'error' && e['err']);
    expect(logged?.['err'].stack).toContain('secret internal detail');
    expect(logged?.['requestId']).toBe(res.headers['x-request-id']);
    expect(JSON.stringify(res.body)).not.toContain('secret internal detail');
  });
});
