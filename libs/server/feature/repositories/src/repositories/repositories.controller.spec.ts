import { Database, DatabaseModule } from '@front-burner/server-core-database';
import { ApiErrorException, ApiExceptionFilter } from '@front-burner/server-core-observability';
import { CanActivate, ExecutionContext, INestApplication, Injectable } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import request from 'supertest';
import { RepositoriesModule } from '../repositories.module';
import { insertRepository, insertUser } from '../testing/fixtures';
import { createTestDatabase } from '../testing/test-database';

/** Mirrors the global auth guard of `server-feature-auth` (LG-34). */
@Injectable()
class StubAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.switchToHttp().getRequest<Request>().auth === undefined) {
      throw new ApiErrorException(401, 'unauthenticated');
    }
    return true;
  }
}

describe('RepositoriesController', () => {
  let app: INestApplication;
  let database: Database;

  beforeEach(async () => {
    database = createTestDatabase();
    const moduleRef = await Test.createTestingModule({
      imports: [ DatabaseModule.forRoot(database), RepositoriesModule ],
      providers: [
        { provide: APP_GUARD, useClass: StubAuthGuard },
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor }
      ]
    }).compile();
    app = moduleRef.createNestApplication();
    // Stands in for the auth middleware: the test names the user in a header.
    app.use((req: Request, _res: Response, next: NextFunction) => {
      const userId = req.header('x-test-user');
      if (userId !== undefined) {
        req.auth = { userId: Number(userId), sessionId: 'session' };
      }
      next();
    });
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    database.sqlite.close();
  });

  it('shows the remote without credentials', async () => {
    const alice = insertUser(database, 'alice@example.com');
    const id = insertRepository(database, alice, {
      name: 'handbook',
      remoteUrl: 'https://u:t@github.com/acme/handbook.git',
      lastAccessedAt: new Date(Date.UTC(2026, 9, 26, 10))
    });

    const response = await request(app.getHttpServer())
      .get('/api/v1/repositories/recent')
      .set('x-test-user', String(alice))
      .expect(200);

    expect(response.body).toEqual({
      repositories: [ {
        id,
        name: 'handbook',
        remote: 'github.com/acme/handbook',
        status: 'ready',
        error: null,
        warnings: [],
        lastAccessedAt: '2026-10-26T10:00:00.000Z'
      } ]
    });
    expect(JSON.stringify(response.body)).not.toContain('u:t');
  });

  it('returns only the logged-in user\'s repositories', async () => {
    const alice = insertUser(database, 'alice@example.com');
    const bob = insertUser(database, 'bob@example.com');
    insertRepository(database, bob, { name: 'secret' });

    const response = await request(app.getHttpServer())
      .get('/api/v1/repositories/recent')
      .set('x-test-user', String(alice))
      .expect(200);

    expect(response.body).toEqual({ repositories: [] });
  });

  it('requires a login', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/repositories/recent').expect(401);
    expect(response.body.code).toBe('unauthenticated');
  });
});
