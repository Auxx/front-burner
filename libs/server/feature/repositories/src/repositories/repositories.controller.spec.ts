import { Config, ConfigModule } from '@front-burner/server-core-config';
import { CryptoModule } from '@front-burner/server-core-crypto';
import { Database, DatabaseModule, jobs } from '@front-burner/server-core-database';
import { EventsModule } from '@front-burner/server-core-events';
import { GitModule } from '@front-burner/server-core-git';
import { GitHttpServer, startGitHttpServer } from '@front-burner/server-core-git/testing';
import { JobsModule } from '@front-burner/server-core-jobs';
import { ApiErrorException, ApiExceptionFilter } from '@front-burner/server-core-observability';
import { RateLimitModule, SessionLifecycleModule } from '@front-burner/server-core-security';
import { StorageModule } from '@front-burner/server-core-storage';
import { CanActivate, ExecutionContext, INestApplication, Injectable } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import type { NextFunction, Request, Response } from 'express';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { RepositoriesModule } from '../repositories.module';
import { insertRepository, insertUser } from '../testing/fixtures';
import { createRemotes, testGitOptions, trustTestCertificate } from '../testing/git-fixtures';
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
  let restoreCa: () => void;
  let root: string;
  let server: GitHttpServer;
  let app: INestApplication;
  let database: Database;

  const http = () => request(app.getHttpServer());

  beforeAll(() => {
    restoreCa = trustTestCertificate();
  });

  afterAll(() => {
    restoreCa();
  });

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'fb-repositories-controller-'));
    const { handbook } = createRemotes(root);
    server = await startGitHttpServer({ repositories: { 'handbook.git': handbook } });
    const dataDir = join(root, 'data');
    mkdirSync(join(dataDir, 'tmp'), { recursive: true });
    mkdirSync(join(dataDir, 'repos'), { recursive: true });
    const config = {
      dataDir,
      encryptionKey: 'repositories-controller-spec-key-0123456789',
      keyUnlockIdleMs: 3_600_000,
      cloneConcurrency: 2
    } as Config;
    database = createTestDatabase();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(config),
        DatabaseModule.forRoot(database),
        CryptoModule.forRoot(config),
        StorageModule,
        GitModule.forRoot(testGitOptions()),
        RateLimitModule,
        EventsModule,
        SessionLifecycleModule,
        JobsModule,
        RepositoriesModule
      ],
      providers: [
        { provide: APP_GUARD, useClass: StubAuthGuard },
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor }
      ]
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    // Stands in for the auth middleware: the test names the user in a header.
    app.use((req: Request, _res: Response, next: NextFunction) => {
      const userId = req.header('x-test-user');
      if (userId !== undefined) {
        req.auth = { userId: Number(userId), sessionId: 'session', authTokenExpiresAt: Number.MAX_SAFE_INTEGER };
      }
      next();
    });
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    await server.close();
    database.sqlite.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('shows the remote without credentials', async () => {
    const alice = insertUser(database, 'alice@example.com');
    const id = insertRepository(database, alice, {
      name: 'handbook',
      remoteUrl: 'https://u:t@github.com/acme/handbook.git',
      lastAccessedAt: new Date(Date.UTC(2026, 9, 26, 10))
    });

    const response = await http().get('/api/v1/repositories/recent').set('x-test-user', String(alice)).expect(200);

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

    const response = await http().get('/api/v1/repositories/recent').set('x-test-user', String(alice)).expect(200);

    expect(response.body).toEqual({ repositories: [] });
  });

  it('requires a login', async () => {
    const response = await http().get('/api/v1/repositories/recent').expect(401);
    expect(response.body.code).toBe('unauthenticated');
    await http().get('/api/v1/repositories/index').expect(401);
    await http().post('/api/v1/repositories/access-check').send({}).expect(401);
    await http().post('/api/v1/repositories').send({}).expect(401);
  });

  it('indexes the user\'s names and remotes', async () => {
    const alice = insertUser(database, 'alice@example.com');
    insertRepository(database, alice, { name: 'Handbook' });

    const response = await http().get('/api/v1/repositories/index').set('x-test-user', String(alice)).expect(200);

    expect(response.body).toEqual({ repositories: [ { name: 'Handbook', remoteKey: 'github.com/acme/handbook' } ] });
  });

  it('lists the branches of a remote', async () => {
    const alice = insertUser(database, 'alice@example.com');

    const response = await http().post('/api/v1/repositories/access-check').set('x-test-user', String(alice))
      .send({ remoteUrl: `${server.url}/handbook.git`, credentials: { mode: 'none' } })
      .expect(200);

    expect(response.body).toEqual({ branches: [ 'draft', 'main' ], defaultBranch: 'main' });
  });

  it('adds a repository and answers with its summary', async () => {
    const alice = insertUser(database, 'alice@example.com');

    const response = await http().post('/api/v1/repositories').set('x-test-user', String(alice))
      .send({
        remoteUrl: `${server.url}/handbook.git`,
        name: 'Handbook',
        credentials: { mode: 'none' },
        cloneMode: 'full'
      })
      .expect(201);

    expect(response.body).toMatchObject({ name: 'Handbook', status: 'cloning', error: null, warnings: [] });
    expect(database.db.select().from(jobs).where(eq(jobs.type, 'repositories.clone')).all()).toHaveLength(1);
  });

  it('checks the request\'s object rules', async () => {
    const alice = insertUser(database, 'alice@example.com');

    const response = await http().post('/api/v1/repositories').set('x-test-user', String(alice))
      .send({
        remoteUrl: 'git@github.com:acme/handbook.git',
        name: 'H',
        credentials: { mode: 'none' },
        cloneMode: 'single-branch'
      })
      .expect(400);

    expect(response.body.fields).toEqual([
      { path: 'credentials', code: 'protocol-mismatch', params: {} },
      { path: 'branch', code: 'required', params: {} }
    ]);
  });

  it('refuses the 31st access check in a minute', async () => {
    const alice = insertUser(database, 'alice@example.com');
    for (let i = 0; i < 15; i++) {
      await http().post('/api/v1/repositories/access-check').set('x-test-user', String(alice)).send({}).expect(400);
      await http().post('/api/v1/repositories').set('x-test-user', String(alice)).send({}).expect(400);
    }

    const response = await http().post('/api/v1/repositories/access-check').set('x-test-user', String(alice))
      .send({})
      .expect(429);

    expect(response.body.code).toBe('rate-limited');
  });
});
