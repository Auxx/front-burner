import { Config, ConfigModule } from '@front-burner/server-core-config';
import { Database, DatabaseModule, users } from '@front-burner/server-core-database';
import { EventsHub } from '@front-burner/server-core-events';
import { ApiExceptionFilter } from '@front-burner/server-core-observability';
import { AdminOnly, SessionLifecycle } from '@front-burner/server-core-security';
import {
  Controller,
  Get,
  INestApplication,
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { SignJWT } from 'jose';
import request from 'supertest';
import { createTestDatabase } from '../testing/test-database';
import { AdminOnlyGuard } from './admin-only.guard';
import { AuthTokenService } from './auth-token.service';
import { AuthGuard } from './auth.guard';
import { AuthMiddleware } from './auth.middleware';
import { SESSION_REUSE_HANDLER, SessionService } from './session.service';

const config = {
  jwtSecret: 'admin-only-guard-spec-secret-0123456789abcdefghijk',
  authTokenTtlMs: 15 * 60_000,
  refreshTokenTtlMs: 30 * 86_400_000
} as Config;

@Controller('things')
class ThingsController {
  @Get()
  list(): { ok: boolean; } {
    return { ok: true };
  }

  @Get('admin')
  @AdminOnly()
  admin(): { ok: boolean; } {
    return { ok: true };
  }
}

@AdminOnly()
@Controller('admin')
class AdminController {
  @Get()
  get(): { ok: boolean; } {
    return { ok: true };
  }
}

@Module({
  controllers: [ ThingsController, AdminController ],
  providers: [
    AuthTokenService,
    SessionService,
    EventsHub,
    SessionLifecycle,
    { provide: SESSION_REUSE_HANDLER, useValue: () => undefined },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: AdminOnlyGuard },
    { provide: APP_FILTER, useClass: ApiExceptionFilter }
  ]
})
class TestAuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AuthMiddleware).forRoutes({ path: '*path', method: RequestMethod.ALL });
  }
}

describe('AdminOnlyGuard', () => {
  let app: INestApplication;
  let database: Database;
  let sessions: SessionService;

  const addUser = (email: string, role: 'administrator' | 'user'): number =>
    database.db.insert(users).values({
      email,
      displayName: email,
      role,
      loginMethod: 'password',
      passwordHash: '$argon2id$hash',
      createdAt: new Date()
    }).returning().get().id;

  const tokenOf = async (id: number): Promise<string> =>
    (await sessions.start({ id }, 'password', 'cookie')).tokens.authToken;

  const get = (path: string, token?: string) => {
    const call = request(app.getHttpServer()).get(path);
    return token === undefined ? call : call.set('Authorization', `Bearer ${token}`);
  };

  beforeEach(async () => {
    database = createTestDatabase();
    const moduleRef = await Test.createTestingModule({
      imports: [ ConfigModule.forRoot(config), DatabaseModule.forRoot(database), TestAuthModule ]
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    sessions = app.get(SessionService);
  });

  afterEach(async () => {
    await app.close();
    database.sqlite.close();
  });

  it('an administrator passes an admin-only route', async () => {
    const token = await tokenOf(addUser('admin@x.io', 'administrator'));

    expect((await get('/things/admin', token)).status).toBe(200);
    expect((await get('/admin', token)).status).toBe(200);
  });

  it('a user gets 403 forbidden on an admin-only route', async () => {
    const token = await tokenOf(addUser('bob@x.io', 'user'));

    for (const path of [ '/things/admin', '/admin' ]) {
      const response = await get(path, token);
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('forbidden');
    }
  });

  it('a route without the decorator is unchanged', async () => {
    const token = await tokenOf(addUser('bob@x.io', 'user'));

    expect((await get('/things', token)).status).toBe(200);
    expect((await get('/things')).status).toBe(401);
  });

  it('an expired auth token still gets auth-token-expired, so that the client refreshes', async () => {
    const { sessionId } = await sessions.start({ id: addUser('admin@x.io', 'administrator') }, 'password', 'cookie');
    const expired = await new SignJWT({ sid: sessionId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('1')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 120)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(config.jwtSecret));

    const response = await get('/admin', expired);
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('auth-token-expired');
  });

  it('an unauthenticated request gets 401 before the role is checked', async () => {
    for (const path of [ '/things/admin', '/admin' ]) {
      const response = await get(path);
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('unauthenticated');
    }
  });
});
