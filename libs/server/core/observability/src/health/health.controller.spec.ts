import { CONFIG } from '@front-burner/server-core-config';
import { DATABASE } from '@front-burner/server-core-database';
import { HealthStatusSchema } from '@front-burner/shared-contracts';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HealthModule } from './health.module';

async function createApp(migrationsApplied: boolean): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [ HealthModule.forRoot({ migrationsApplied }) ] })
    .useMocker(token => {
      if (token === CONFIG) {
        return { dataDir: '/tmp' };
      }
      if (token === DATABASE) {
        return { sqlite: { prepare: () => ({ get: () => ({}) }) } };
      }
      return undefined;
    })
    .compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

describe('HealthController', () => {
  it('answers live with 200 ok', async () => {
    const app = await createApp(true);
    const res = await request(app.getHttpServer()).get('/api/health/live');
    expect(res.status).toBe(200);
    expect(HealthStatusSchema.parse(res.body)).toEqual({ status: 'ok' });
    await app.close();
  });

  it('answers ready with 200 ok when ready', async () => {
    const app = await createApp(true);
    const res = await request(app.getHttpServer()).get('/api/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    await app.close();
  });

  it('answers ready with 503 fail when migrations were not applied', async () => {
    const app = await createApp(false);
    const res = await request(app.getHttpServer()).get('/api/health/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'fail' });
    await app.close();
  });
});
