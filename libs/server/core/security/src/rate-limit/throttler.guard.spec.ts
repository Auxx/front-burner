import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import request from 'supertest';
import '../auth/request-auth';
import { RateLimitGroup } from './rate-limit-group.decorator';
import { RateLimitModule } from './rate-limit.module';

@Controller('ping')
class PingController {
  @Get()
  ping(): { ok: boolean; } {
    return { ok: true };
  }
}

@Controller('first')
class FirstController {
  @Get('grouped')
  @RateLimitGroup('setup-token')
  grouped(): { ok: boolean; } {
    return { ok: true };
  }

  @Get('plain')
  plain(): { ok: boolean; } {
    return { ok: true };
  }
}

@Controller('second')
class SecondController {
  @Get('grouped')
  @RateLimitGroup('setup-token')
  grouped(): { ok: boolean; } {
    return { ok: true };
  }
}

@Controller('remote')
class RemoteController {
  @Get('check')
  @RateLimitGroup('access-check')
  check(): { ok: boolean; } {
    return { ok: true };
  }

  @Get('add')
  @RateLimitGroup('access-check')
  add(): { ok: boolean; } {
    return { ok: true };
  }
}

describe('AppThrottlerGuard', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ RateLimitModule ],
      controllers: [ PingController, FirstController, SecondController, RemoteController ]
    }).compile();
    app = moduleRef.createNestApplication();
    // Stands in for the authentication middleware, which runs before every guard.
    app.use((req: Request, _res: unknown, next: () => void) => {
      const user = req.headers['x-test-user'];
      if (typeof user === 'string') {
        req.auth = { userId: Number(user), sessionId: `session-${user}`, authTokenExpiresAt: Number.MAX_SAFE_INTEGER };
      }
      next();
    });
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

  it('routes of a group share 10 requests per minute', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await request(app.getHttpServer()).get('/first/grouped')).status).toBe(200);
      expect((await request(app.getHttpServer()).get('/second/grouped')).status).toBe(200);
    }
    const limited = await request(app.getHttpServer()).get('/first/grouped');
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toMatch(/^[1-9]\d*$/);
  });

  it('allows an authenticated user 600 requests per minute', async () => {
    for (let i = 0; i < 600; i++) {
      expect((await request(app.getHttpServer()).get('/ping').set('x-test-user', '1')).status).toBe(200);
    }
    expect((await request(app.getHttpServer()).get('/ping').set('x-test-user', '1')).status).toBe(429);
  });

  it('counts authenticated requests per user, not per address', async () => {
    for (let i = 0; i < 600; i++) {
      expect((await request(app.getHttpServer()).get('/ping').set('x-test-user', '1')).status).toBe(200);
    }
    for (let i = 0; i < 600; i++) {
      expect((await request(app.getHttpServer()).get('/ping').set('x-test-user', '2')).status).toBe(200);
    }
    // The address's own counter is untouched by them.
    expect((await request(app.getHttpServer()).get('/ping')).status).toBe(200);
  });

  it('counts a group per address even for authenticated users', async () => {
    // LG-65: login is limited by client IP; holding sessions must not buy more attempts.
    for (let i = 0; i < 10; i++) {
      const user = String(i % 2);
      expect((await request(app.getHttpServer()).get('/first/grouped').set('x-test-user', user)).status).toBe(200);
    }
    expect((await request(app.getHttpServer()).get('/first/grouped').set('x-test-user', '3')).status).toBe(429);
    expect((await request(app.getHttpServer()).get('/first/grouped')).status).toBe(429);
  });

  it('allows each user 30 access checks per minute across the group', async () => {
    for (let i = 0; i < 15; i++) {
      expect((await request(app.getHttpServer()).get('/remote/check').set('x-test-user', '1')).status).toBe(200);
      expect((await request(app.getHttpServer()).get('/remote/add').set('x-test-user', '1')).status).toBe(200);
    }
    expect((await request(app.getHttpServer()).get('/remote/check').set('x-test-user', '1')).status).toBe(429);
    // AR-55: per user, so another user of the same address is not limited.
    expect((await request(app.getHttpServer()).get('/remote/check').set('x-test-user', '2')).status).toBe(200);
    // Each group has its own counter.
    expect((await request(app.getHttpServer()).get('/first/grouped').set('x-test-user', '1')).status).toBe(200);
  });

  it('a route without a group keeps 60 per minute', async () => {
    for (let i = 0; i < 10; i++) {
      await request(app.getHttpServer()).get('/first/grouped');
    }
    for (let i = 0; i < 11; i++) {
      expect((await request(app.getHttpServer()).get('/first/plain')).status).toBe(200);
    }
  });
});
