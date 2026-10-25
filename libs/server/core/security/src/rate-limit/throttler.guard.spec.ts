import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { RateLimitModule } from './rate-limit.module';

@Controller('ping')
class PingController {
  @Get()
  ping(): { ok: boolean; } {
    return { ok: true };
  }
}

describe('AppThrottlerGuard', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ RateLimitModule ],
      controllers: [ PingController ]
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('allows 60 requests per minute', async () => {
    for (let i = 0; i < 60; i++) {
      expect((await request(app.getHttpServer()).get('/ping')).status).toBe(200);
    }
    expect((await request(app.getHttpServer()).get('/ping')).status).toBe(429);
  });

  it('sets Retry-After on 429', async () => {
    for (let i = 0; i < 60; i++) {
      await request(app.getHttpServer()).get('/ping');
    }
    const res = await request(app.getHttpServer()).get('/ping');
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toMatch(/^[1-9]\d*$/);
    expect(Number(res.headers['retry-after'])).toBeLessThanOrEqual(60);
  });

  it('sends no X-RateLimit headers', async () => {
    const ok = await request(app.getHttpServer()).get('/ping');
    expect(Object.keys(ok.headers).filter(h => h.startsWith('x-ratelimit'))).toEqual([]);
    for (let i = 0; i < 60; i++) {
      await request(app.getHttpServer()).get('/ping');
    }
    const limited = await request(app.getHttpServer()).get('/ping');
    expect(Object.keys(limited.headers).filter(h => h.startsWith('x-ratelimit'))).toEqual([]);
  });
});
