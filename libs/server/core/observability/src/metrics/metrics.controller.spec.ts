import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Registry } from 'prom-client';
import request from 'supertest';
import { METRICS_REGISTRY } from './metrics-registry';
import { MetricsModule } from './metrics.module';

const TOKEN = 'metrics-token-0123456789';

async function createApp(metricsToken: string | undefined): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [ MetricsModule.forRoot({ metricsToken }) ] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

describe('MetricsController', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('the endpoint does not exist without a token', async () => {
    app = await createApp(undefined);

    const metrics = await request(app.getHttpServer()).get('/api/metrics').set('Authorization', `Bearer ${TOKEN}`);
    const unknown = await request(app.getHttpServer()).get('/api/nothing-here');

    expect(unknown.status).toBe(404);
    expect(metrics.status).toBe(404);
    expect(metrics.body).toEqual({ ...unknown.body, message: 'Cannot GET /api/metrics' });
    // Other libraries can still register their metrics.
    expect(app.get<Registry>(METRICS_REGISTRY)).toBeInstanceOf(Registry);
  });

  it('serves metrics with the right bearer token', async () => {
    app = await createApp(TOKEN);

    const response = await request(app.getHttpServer()).get('/api/metrics').set('Authorization', `Bearer ${TOKEN}`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.text).toContain('front_burner_process_cpu_seconds_total');
    expect(response.text).toContain('front_burner_nodejs_heap_size_used_bytes');
  });

  it('refuses a wrong token like a missing one', async () => {
    app = await createApp(TOKEN);
    const server = app.getHttpServer();

    const responses = [
      await request(server).get('/api/metrics'),
      await request(server).get('/api/metrics').set('Authorization', `Bearer ${TOKEN}x`),
      await request(server).get('/api/metrics').set('Authorization', `Bearer ${TOKEN.slice(1)}`),
      await request(server).get('/api/metrics').set('Authorization', TOKEN),
      await request(server).get('/api/metrics').set('Authorization', `Basic ${TOKEN}`)
    ];

    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.headers['www-authenticate']).toBe('Bearer');
      expect(response.text).not.toContain('front_burner_');
      expect({ ...response.body, requestId: undefined }).toEqual({ ...responses[0].body, requestId: undefined });
    }
  });
});
