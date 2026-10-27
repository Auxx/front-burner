import { Config, ConfigModule } from '@front-burner/server-core-config';
import { Database, DatabaseModule, users } from '@front-burner/server-core-database';
import { EventsHub } from '@front-burner/server-core-events';
import { ApiExceptionFilter } from '@front-burner/server-core-observability';
import { Public } from '@front-burner/server-core-security';
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
import { AuthTokenService } from './auth-token.service';
import { AuthGuard } from './auth.guard';
import { AuthMiddleware } from './auth.middleware';
import { SESSION_REUSE_HANDLER, SessionService } from './session.service';

const config = {
  jwtSecret: 'auth-guard-spec-secret-0123456789abcdefghijklmn',
  authTokenTtlMs: 15 * 60_000,
  refreshTokenTtlMs: 30 * 86_400_000
} as Config;

@Controller('private')
class PrivateController {
  @Get()
  get(): { ok: boolean; } {
    return { ok: true };
  }

  @Get('public')
  @Public()
  open(): { ok: boolean; } {
    return { ok: true };
  }
}

@Public()
@Controller('open')
class OpenController {
  @Get()
  get(): { ok: boolean; } {
    return { ok: true };
  }
}

@Module({
  controllers: [ PrivateController, OpenController ],
  providers: [
    AuthTokenService,
    SessionService,
    EventsHub,
    { provide: SESSION_REUSE_HANDLER, useValue: () => undefined },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: ApiExceptionFilter }
  ],
  exports: [ SessionService ]
})
class TestAuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AuthMiddleware).forRoutes({ path: '*path', method: RequestMethod.ALL });
  }
}

describe('AuthGuard', () => {
  let app: INestApplication;
  let database: Database;
  let sessions: SessionService;
  let userId: number;

  beforeEach(async () => {
    database = createTestDatabase();
    userId = database.db.insert(users).values({
      email: 'alice@x.io',
      displayName: 'Alice',
      role: 'user',
      loginMethod: 'password',
      passwordHash: '$argon2id$hash',
      createdAt: new Date()
    }).returning().get().id;
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

  const get = (path: string, token?: string) => {
    const call = request(app.getHttpServer()).get(path);
    return token === undefined ? call : call.set('Authorization', `Bearer ${token}`);
  };

  it('allows a public route without a token', async () => {
    expect((await get('/private/public')).status).toBe(200);
    expect((await get('/open')).status).toBe(200);
  });

  it('allows a valid token', async () => {
    const { tokens } = await sessions.start({ id: userId }, 'password', 'cookie');
    expect((await get('/private', tokens.authToken)).status).toBe(200);
  });

  it('refuses a missing token with unauthenticated', async () => {
    const response = await get('/private');
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('unauthenticated');
  });

  it('refuses an expired token with auth-token-expired', async () => {
    const { sessionId } = await sessions.start({ id: userId }, 'password', 'cookie');
    const expired = await new SignJWT({ sid: sessionId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(String(userId))
      .setIssuedAt(Math.floor(Date.now() / 1000) - 120)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(config.jwtSecret));

    const response = await get('/private', expired);
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('auth-token-expired');
  });

  it('refuses a revoked session with unauthenticated', async () => {
    const issued = await sessions.start({ id: userId }, 'password', 'cookie');
    sessions.revokeByRefreshToken(issued.refreshToken);

    const response = await get('/private', issued.tokens.authToken);
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('unauthenticated');
  });

  it('refuses garbage with unauthenticated', async () => {
    const response = await get('/private', 'not-a-jwt');
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('unauthenticated');
  });
});
