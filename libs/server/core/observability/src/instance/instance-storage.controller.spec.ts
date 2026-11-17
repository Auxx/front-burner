import { DiskMonitor } from '@front-burner/server-core-storage';
import { InstanceStorageSchema } from '@front-burner/shared-contracts';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { InstanceModule } from './instance.module';

describe('InstanceStorageController', () => {
  let app: INestApplication;
  let low: boolean;

  beforeEach(async () => {
    low = false;
    const moduleRef = await Test.createTestingModule({ imports: [ InstanceModule ] })
      .useMocker(token => (token === DiskMonitor ? { isLow: () => low } : undefined))
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('answers whether storage is low', async () => {
    const before = await request(app.getHttpServer()).get('/instance/storage');
    expect(before.status).toBe(200);
    expect(InstanceStorageSchema.parse(before.body)).toEqual({ low: false });

    low = true;
    const after = await request(app.getHttpServer()).get('/instance/storage');
    expect(after.body).toEqual({ low: true });
  });
});
