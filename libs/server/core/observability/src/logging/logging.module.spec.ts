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

@Controller('api/v1/t')
class ApiLogController {
  @Get('items/:id')
  item() {
    return { ok: true };
  }

  @Get('redirect')
  redirect(@Res() res: { redirect(status: number, url: string): void; }) {
    res.redirect(302, '/login/oidc?code=secret-one-time-code');
  }
}

const config: Config = {
  version: '0.0.0',
  port: 3000,
  trustedProxies: [],
  logLevel: 'info',
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
      controllers: [ LogController, ApiLogController ],
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

    expect(output).toContain('"url":"/t/…"');
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

  it('logs the request without its query, which may name a file (NF-10.5)', async () => {
    output = '';
    await request(app.getHttpServer()).get('/t/log?path=private/diary.md');

    const completed = entries().find(e => e['message'] === 'request completed');
    expect(completed?.['req'].url).toBe('/t/…');
    expect(completed?.['req'].method).toBe('GET');
    expect(output).not.toContain('diary');
  });

  it('logs three segments of an API path, and the whole path once a route answered it (NF-10.5)', async () => {
    output = '';
    await request(app.getHttpServer()).get('/api/v1/t/items/7?path=private/diary.md');
    await request(app.getHttpServer()).get('/api/v1/t/private/diary.md');

    const lines = entries().filter(e => e['message'] === 'request completed').map(e => [ e['req'].url, e['path'] ]);
    expect(lines).toEqual([ [ '/api/v1/t/…', '/api/v1/t/items/7' ], [ '/api/v1/t/…', undefined ] ]);
    expect(output).not.toContain('diary');
  });

  it('logs a redirect\'s Location without its query, which may hold a one-time code (NF-10.5)', async () => {
    output = '';
    await request(app.getHttpServer()).get('/api/v1/t/redirect');

    const completed = entries().find(e => e['message'] === 'request completed');
    expect(completed?.['res'].statusCode).toBe(302);
    expect(completed?.['res'].headers.location).toBe('/login/…');
    expect(output).not.toContain('secret-one-time-code');
  });

  it('logs the whole URL at debug', async () => {
    let debugOutput = '';
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        debugOutput += chunk.toString();
        callback();
      }
    });
    const debugLogger = createRequestLogger({ ...config, logLevel: 'debug' }, destination);
    const debugApp = (await Test.createTestingModule({ controllers: [ LogController ] }).compile())
      .createNestApplication();
    debugApp.use(debugLogger);
    await debugApp.init();
    try {
      await request(debugApp.getHttpServer()).get('/t/log?path=private/diary.md');
    } finally {
      await debugApp.close();
    }

    expect(debugOutput).toContain('"url":"/t/log?path=private/diary.md"');
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
