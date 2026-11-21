import { Controller, Get, INestApplication, NotFoundException, Res } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Response } from 'express';
import request from 'supertest';
import { SERVER_TIMING_HEADER, serverTiming } from './server-timing';

@Controller()
class TimedController {
  @Get('api/v1/items')
  items(): { ok: boolean; } {
    return { ok: true };
  }

  @Get('api/v1/missing')
  missing(): never {
    throw new NotFoundException();
  }

  @Get('api/v1/stream')
  stream(@Res() res: Response): void {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end('data: 1\n\n');
  }

  @Get('api/health/live')
  live(): { status: string; } {
    return { status: 'ok' };
  }

  @Get('index.html')
  page(): string {
    return '<html></html>';
  }
}

const HEADER = SERVER_TIMING_HEADER.toLowerCase();

describe('serverTiming', () => {
  let app: INestApplication;

  const createApp = async (timed: boolean) => {
    const moduleRef = await Test.createTestingModule({ controllers: [ TimedController ] }).compile();
    const created = moduleRef.createNestApplication({ logger: false });
    if (timed) {
      created.use(serverTiming({ except: [ 'api/health/live' ] }));
    }
    await created.init();
    return created;
  };

  afterEach(async () => {
    await app.close();
  });

  it('with the variable on, every API response carries its duration in Server-Timing', async () => {
    app = await createApp(true);

    const ok = await request(app.getHttpServer()).get('/api/v1/items');
    const missing = await request(app.getHttpServer()).get('/api/v1/missing');
    const stream = await request(app.getHttpServer()).get('/api/v1/stream');
    const unknown = await request(app.getHttpServer()).get('/api/v1/nothing-here');

    for (const response of [ ok, missing, stream, unknown ]) {
      // Only a duration: never a route or ID.
      expect(response.headers[HEADER]).toMatch(/^app;dur=\d+\.\d$/);
    }
  });

  it('the health endpoints never carry it, nor the web client\'s responses', async () => {
    app = await createApp(true);

    expect((await request(app.getHttpServer()).get('/api/health/live')).headers[HEADER]).toBeUndefined();
    expect((await request(app.getHttpServer()).get('/API/Health/Live/')).headers[HEADER]).toBeUndefined();
    expect((await request(app.getHttpServer()).get('/index.html')).headers[HEADER]).toBeUndefined();
  });

  it('no Server-Timing when it is not attached', async () => {
    app = await createApp(false);

    expect((await request(app.getHttpServer()).get('/api/v1/items')).headers[HEADER]).toBeUndefined();
  });
});
