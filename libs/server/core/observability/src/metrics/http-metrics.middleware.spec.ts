import {
  Controller,
  Get,
  INestApplication,
  MiddlewareConsumer,
  Module,
  NestModule,
  NotFoundException,
  Param,
  RequestMethod,
  Res
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Response } from 'express';
import { Registry } from 'prom-client';
import request from 'supertest';
import { metricSamples } from '../testing';
import { HTTP_REQUEST_DURATION, httpMetrics, UNMATCHED_ROUTE } from './http-metrics.middleware';

@Controller('repositories')
class RepositoriesController {
  @Get(':id')
  one(@Param('id') id: string): { id: string; } {
    if (id === 'missing') {
      throw new NotFoundException();
    }
    return { id };
  }

  @Get(':id/files/*path')
  file(): string {
    return 'text';
  }

  /** Answers after the client has given up. */
  @Get(':id/slow')
  async slow(): Promise<string> {
    await new Promise(resolve => setTimeout(resolve, 300));
    return 'late';
  }

  /** A push channel's stream, as `GET /api/v1/events`. */
  @Get(':id/stream')
  stream(@Res() res: Response): void {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: 1\n\n');
    res.end();
  }
}

/** A Nest middleware for every route, as the auth middleware: Nest registers it as an Express `all()` route. */
@Module({ controllers: [ RepositoriesController ] })
class TestModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply((_req: unknown, _res: unknown, next: () => void) => next())
      .forRoutes({ path: '*path', method: RequestMethod.ALL });
  }
}

describe('httpMetrics', () => {
  let app: INestApplication;
  let registry: Registry;

  beforeEach(async () => {
    registry = new Registry();
    const moduleRef = await Test.createTestingModule({ imports: [ TestModule ] }).compile();
    app = moduleRef.createNestApplication();
    app.use(httpMetrics(registry));
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  /** The `_count` samples of the histogram, one per label set. */
  const counts = () => metricSamples(registry, HTTP_REQUEST_DURATION, `${HTTP_REQUEST_DURATION}_count`);

  it('times a request by method, route and status', async () => {
    await request(app.getHttpServer()).get('/api/v1/repositories/7').expect(200);
    await request(app.getHttpServer()).get('/api/v1/repositories/missing').expect(404);

    expect(await counts()).toEqual([
      { labels: { method: 'GET', route: '/api/v1/repositories/:id', status: '200' }, value: 1 },
      { labels: { method: 'GET', route: '/api/v1/repositories/:id', status: '404' }, value: 1 }
    ]);
    const metrics = await registry.metrics();
    expect(metrics).toContain(
      `${HTTP_REQUEST_DURATION}_bucket{le="0.005",method="GET",route="/api/v1/repositories/:id",status="200"}`
    );
  });

  it('labels requests by route pattern, not path', async () => {
    await request(app.getHttpServer()).get('/api/v1/repositories/123/files/secret.md').expect(200);
    await request(app.getHttpServer()).get('/api/v1/repositories/456/files/notes/private.md').expect(200);

    expect((await counts()).map(sample => [ sample.labels['route'], sample.value ])).toEqual([
      [ '/api/v1/repositories/:id/files/*path', 2 ]
    ]);
    const metrics = await registry.metrics();
    for (const part of [ '123', '456', 'secret.md', 'private.md' ]) {
      expect(metrics).not.toContain(part);
    }
  });

  it('an unmatched route is labelled as such', async () => {
    await request(app.getHttpServer()).get('/api/v1/nothing/here').expect(404);
    await request(app.getHttpServer()).post('/api/v1/repositories/1').expect(404);
    await request(app.getHttpServer()).get('/api/other').expect(404);

    expect((await counts()).map(sample => [ sample.labels, sample.value ])).toEqual([
      [ { method: 'GET', route: UNMATCHED_ROUTE, status: '404' }, 2 ],
      [ { method: 'POST', route: UNMATCHED_ROUTE, status: '404' }, 1 ]
    ]);
    expect(await registry.metrics()).not.toContain('nothing');
  });

  it('times a request whose client gave up as aborted', async () => {
    await expect(request(app.getHttpServer()).get('/api/v1/repositories/1/slow').timeout(50)).rejects.toThrow();

    await vi.waitFor(async () => {
      expect((await counts()).map(sample => [ sample.labels, sample.value ])).toEqual([
        [ { method: 'GET', route: '/api/v1/repositories/:id/slow', status: 'aborted' }, 1 ]
      ]);
    });
  });

  it('leaves out event streams, which stay open for as long as a tab', async () => {
    await request(app.getHttpServer()).get('/api/v1/repositories/1/stream').expect(200);
    await request(app.getHttpServer()).get('/api/v1/repositories/1').expect(200);

    expect((await counts()).map(sample => sample.labels['route'])).toEqual([ '/api/v1/repositories/:id' ]);
  });

  it('times API requests in any case, as Express routes them', async () => {
    await request(app.getHttpServer()).get('/API/v1/repositories/7').expect(200);

    expect((await counts()).map(sample => [ sample.labels['route'], sample.value ])).toEqual([
      [ '/api/v1/repositories/:id', 1 ]
    ]);
  });

  it('leaves out requests outside the API, such as the web client\'s', async () => {
    await request(app.getHttpServer()).get('/login').expect(404);
    await request(app.getHttpServer()).get('/main.js').expect(404);

    expect(await counts()).toEqual([]);
  });
});
