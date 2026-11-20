import { Config, ConfigModule } from '@front-burner/server-core-config';
import { CryptoModule } from '@front-burner/server-core-crypto';
import { Database, DatabaseModule, jobs } from '@front-burner/server-core-database';
import { EventsModule } from '@front-burner/server-core-events';
import { GitModule } from '@front-burner/server-core-git';
import {
  FIXTURE_PASSPHRASE,
  GitHttpServer,
  sshKeyFixture,
  startGitHttpServer
} from '@front-burner/server-core-git/testing';
import { JobsModule } from '@front-burner/server-core-jobs';
import { ApiErrorException, ApiExceptionFilter, MetricsModule } from '@front-burner/server-core-observability';
import { RateLimitModule, SessionLifecycleModule } from '@front-burner/server-core-security';
import { StorageModule } from '@front-burner/server-core-storage';
import { SavedCredentialsService } from '@front-burner/server-feature-credentials';
import { CanActivate, ExecutionContext, INestApplication, Injectable } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import type { NextFunction, Request, Response } from 'express';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { CLONE_JOB_TYPE } from '../clone/clone-queue';
import { RepositoriesModule } from '../repositories.module';
import { insertRepository, insertUser } from '../testing/fixtures';
import { createRemotes, git, testGitOptions, trustTestCertificate } from '../testing/git-fixtures';
import { createTestDatabase } from '../testing/test-database';
import { RemoteProblemsSource } from '../warnings/remote-problems-source';

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
        MetricsModule.forRoot(config),
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
        const sessionId = req.header('x-test-session') ?? 'session';
        req.auth = { userId: Number(userId), sessionId, authTokenExpiresAt: Number.MAX_SAFE_INTEGER };
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
        clone: null,
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

  it('excludes the current repository and still returns ten', async () => {
    const alice = insertUser(database, 'alice@example.com');
    const ids = Array.from(
      { length: 11 },
      (_, i) => insertRepository(database, alice, { name: `repo-${i}`, lastAccessedAt: new Date(i * 1000) })
    );
    const current = ids[5];

    const response = await http().get(`/api/v1/repositories/recent?exclude=${current}`)
      .set('x-test-user', String(alice)).expect(200);

    const names = response.body.repositories.map((r: { name: string; }) => r.name);
    expect(names).toEqual([ 10, 9, 8, 7, 6, 4, 3, 2, 1, 0 ].map(i => `repo-${i}`));
  });

  it('ignores another user\'s ID in exclude', async () => {
    const alice = insertUser(database, 'alice@example.com');
    const bob = insertUser(database, 'bob@example.com');
    insertRepository(database, alice, { name: 'handbook' });
    const secret = insertRepository(database, bob, { name: 'secret' });

    const plain = await http().get('/api/v1/repositories/recent').set('x-test-user', String(alice)).expect(200);
    const other = await http().get(`/api/v1/repositories/recent?exclude=${secret}`)
      .set('x-test-user', String(alice)).expect(200);
    const missing = await http().get(`/api/v1/repositories/recent?exclude=${secret + 100}`)
      .set('x-test-user', String(alice)).expect(200);

    expect(other.body).toEqual(plain.body);
    expect(missing.body).toEqual(plain.body);
  });

  it('refuses an exclude that is not a positive integer', async () => {
    const alice = insertUser(database, 'alice@example.com');
    await http().get('/api/v1/repositories/recent?exclude=abc').set('x-test-user', String(alice)).expect(400);
  });

  describe('list', () => {
    it('sorts by name ignoring case', async () => {
      const alice = insertUser(database, 'alice@example.com');
      for (const name of [ 'gamma', 'Beta', 'alpha' ]) {
        insertRepository(database, alice, { name });
      }

      const response = await http().get('/api/v1/repositories').set('x-test-user', String(alice)).expect(200);

      expect(response.body.repositories.map((r: { name: string; }) => r.name)).toEqual([ 'alpha', 'Beta', 'gamma' ]);
    });

    it('lists every status, as summaries without credentials', async () => {
      const alice = insertUser(database, 'alice@example.com');
      insertRepository(database, alice, { name: 'a', status: 'cloning' });
      const failed = insertRepository(database, alice, {
        name: 'b',
        status: 'error',
        errorCode: 'clone-failed',
        remoteUrl: 'https://u:t@github.com/acme/handbook.git',
        lastAccessedAt: new Date(Date.UTC(2026, 9, 26, 10))
      });

      const response = await http().get('/api/v1/repositories').set('x-test-user', String(alice)).expect(200);

      expect(response.body.repositories.map((r: { status: string; }) => r.status)).toEqual([ 'cloning', 'error' ]);
      expect(response.body.repositories[1]).toEqual({
        id: failed,
        name: 'b',
        remote: 'github.com/acme/handbook',
        status: 'error',
        error: 'clone-failed',
        warnings: [],
        clone: null,
        lastAccessedAt: '2026-10-26T10:00:00.000Z'
      });
      expect(JSON.stringify(response.body)).not.toContain('u:t');
    });

    it('answers the clone of a cloning repository, with its progress (RM-7)', async () => {
      const alice = insertUser(database, 'alice@example.com');
      const id = insertRepository(database, alice, { name: 'a', status: 'cloning' });
      const job = database.db.insert(jobs).values({
        type: CLONE_JOB_TYPE,
        userId: alice,
        repositoryId: id,
        status: 'running',
        progress: 30,
        runAt: new Date(0),
        createdAt: new Date(0)
      }).returning({ id: jobs.id }).get().id;

      const response = await http().get('/api/v1/repositories').set('x-test-user', String(alice)).expect(200);

      expect(response.body.repositories[0].clone).toEqual({ jobId: job, state: 'running', percent: 30 });
    });

    it('lists only the user\'s own', async () => {
      const alice = insertUser(database, 'alice@example.com');
      const bob = insertUser(database, 'bob@example.com');
      insertRepository(database, bob, { name: 'secret' });

      const response = await http().get('/api/v1/repositories').set('x-test-user', String(alice)).expect(200);

      expect(response.body).toEqual({ repositories: [] });
    });

    it('does not change the last access time', async () => {
      const alice = insertUser(database, 'alice@example.com');
      insertRepository(database, alice, { name: 'handbook', lastAccessedAt: new Date(1000) });

      await http().get('/api/v1/repositories').set('x-test-user', String(alice)).expect(200);
      const response = await http().get('/api/v1/repositories').set('x-test-user', String(alice)).expect(200);

      expect(response.body.repositories[0].lastAccessedAt).toBe(new Date(1000).toISOString());
    });
  });

  describe('details', () => {
    const details = (user: number, id: number) =>
      http().get(`/api/v1/repositories/${id}/details`).set('x-test-user', String(user));

    it('answers the clone mode, level and date added', async () => {
      const alice = insertUser(database, 'alice@example.com');
      const id = insertRepository(database, alice, {
        name: 'handbook',
        gitLevel: 'guided',
        createdAt: new Date(Date.UTC(2026, 9, 20, 8)),
        lastAccessedAt: new Date(Date.UTC(2026, 9, 26, 10))
      });

      const response = await details(alice, id).expect(200);

      expect(response.body).toEqual({
        summary: {
          id,
          name: 'handbook',
          remote: 'github.com/acme/handbook',
          status: 'ready',
          error: null,
          warnings: [],
          clone: null,
          lastAccessedAt: '2026-10-26T10:00:00.000Z'
        },
        cloneMode: 'full',
        branch: null,
        gitLevel: 'guided',
        addedAt: '2026-10-20T08:00:00.000Z',
        errorDetail: null,
        errorRequestId: null,
        remoteProblems: { fetch: null, push: null }
      });
    });

    it('answers the stored problems with their params', async () => {
      const alice = insertUser(database, 'alice@example.com');
      const id = insertRepository(database, alice, { name: 'handbook', remoteUrl: 'git@github.com:acme/handbook.git' });
      const changedKey = {
        code: 'host-key-changed',
        params: { host: 'github.com', port: '22', type: 'ssh-ed25519', key: 'AAAAC3', fingerprint: 'SHA256:new' }
      };
      app.get(RemoteProblemsSource).provide(ids =>
        new Map(ids.map(repositoryId => [
          repositoryId,
          { fetch: changedKey, push: { code: 'push-not-allowed', params: {} } }
        ]))
      );

      const response = await details(alice, id).expect(200);

      expect(response.body.remoteProblems).toEqual({
        fetch: changedKey,
        push: { code: 'push-not-allowed', params: {} }
      });
      expect(response.body.summary.warnings).toEqual([ 'cannot-push', 'host-key-changed' ]);
    });

    it('answers none for a repository in error', async () => {
      const alice = insertUser(database, 'alice@example.com');
      const id = insertRepository(database, alice, { name: 'handbook', status: 'error', errorCode: 'clone-failed' });
      app.get(RemoteProblemsSource).provide(ids =>
        new Map(ids.map(repositoryId => [
          repositoryId,
          { fetch: { code: 'credentials-refused', params: {} }, push: null }
        ]))
      );

      const response = await details(alice, id).expect(200);

      expect(response.body.remoteProblems).toEqual({ fetch: null, push: null });
    });

    it('answers the branch of a single-branch clone', async () => {
      const alice = insertUser(database, 'alice@example.com');
      const id = insertRepository(database, alice, { name: 'handbook', cloneMode: 'single-branch', branch: 'draft' });

      const response = await details(alice, id).expect(200);

      expect(response.body).toMatchObject({ cloneMode: 'single-branch', branch: 'draft' });
    });

    it('answers the error record of a failed clone', async () => {
      const alice = insertUser(database, 'alice@example.com');
      const id = insertRepository(database, alice, {
        name: 'handbook',
        status: 'error',
        errorCode: 'clone-failed',
        errorDetail: 'fatal: repository not found',
        errorRequestId: 'request-7'
      });

      const response = await details(alice, id).expect(200);

      expect(response.body).toMatchObject({
        summary: { status: 'error', error: 'clone-failed' },
        errorDetail: 'fatal: repository not found',
        errorRequestId: 'request-7'
      });
    });

    it('answers the remote without credentials', async () => {
      const alice = insertUser(database, 'alice@example.com');
      const id = insertRepository(database, alice, {
        name: 'handbook',
        remoteUrl: 'https://alice:ghp_token@github.com/acme/handbook.git'
      });

      const response = await details(alice, id).expect(200);

      expect(response.body.summary.remote).toBe('github.com/acme/handbook');
      expect(JSON.stringify(response.body)).not.toContain('alice');
      expect(JSON.stringify(response.body)).not.toContain('ghp_token');
    });

    it('answers another user\'s repository like a missing one', async () => {
      const alice = insertUser(database, 'alice@example.com');
      const bob = insertUser(database, 'bob@example.com');
      const secret = insertRepository(database, bob, { name: 'secret' });
      const strip = (body: Record<string, unknown>) => ({ ...body, requestId: undefined });

      const other = await details(alice, secret).expect(404);
      const none = await details(alice, secret + 100).expect(404);

      expect(other.body.code).toBe('not-found');
      expect(strip(other.body)).toEqual(strip(none.body));
    });
  });

  describe('removal check', () => {
    const removal = (user: number, id: number) =>
      http().get(`/api/v1/repositories/${id}/removal`).set('x-test-user', String(user));

    it('answers what removing would lose', async () => {
      const alice = insertUser(database, 'alice@example.com');
      const id = insertRepository(database, alice, { name: 'handbook' });
      const work = join(root, 'data', 'repos', String(alice), String(id));
      mkdirSync(join(root, 'data', 'repos', String(alice)), { recursive: true });
      git(root, 'clone', '-q', join(root, 'handbook.git'), work);
      git(work, 'commit', '-q', '--allow-empty', '-m', 'local');
      writeFileSync(join(work, 'notes.md'), 'notes\n');

      const response = await removal(alice, id).expect(200);

      expect(response.body).toEqual({
        uncommittedFiles: 1,
        unpushedCommits: 1,
        stashes: 0,
        mergeInProgress: false,
        unreadable: false
      });
    });

    it('answers a ready repository without a working copy as unreadable', async () => {
      const alice = insertUser(database, 'alice@example.com');
      const id = insertRepository(database, alice, { name: 'handbook' });

      const response = await removal(alice, id).expect(200);

      expect(response.body).toEqual({
        uncommittedFiles: 0,
        unpushedCommits: 0,
        stashes: 0,
        mergeInProgress: false,
        unreadable: true
      });
    });

    it('answers another user\'s repository like a missing one', async () => {
      const alice = insertUser(database, 'alice@example.com');
      const bob = insertUser(database, 'bob@example.com');
      const secret = insertRepository(database, bob, { name: 'secret' });
      const strip = (body: Record<string, unknown>) => ({ ...body, requestId: undefined });

      const other = await removal(alice, secret).expect(404);
      const none = await removal(alice, secret + 100).expect(404);

      expect(other.body.code).toBe('not-found');
      expect(strip(other.body)).toEqual(strip(none.body));
    });
  });

  describe('remove', () => {
    const remove = (user: number, id: number, query = '') =>
      http().delete(`/api/v1/repositories/${id}${query}`).set('x-test-user', String(user));

    it('removes a clean repository without a name', async () => {
      const alice = insertUser(database, 'alice@example.com');
      const id = insertRepository(database, alice, { name: 'handbook' });
      const work = join(root, 'data', 'repos', String(alice), String(id));
      mkdirSync(join(root, 'data', 'repos', String(alice)), { recursive: true });
      git(root, 'clone', '-q', join(root, 'handbook.git'), work);

      await remove(alice, id).expect(204);

      await http().get(`/api/v1/repositories/${id}`).set('x-test-user', String(alice)).expect(404);
    });

    it('refuses without the name when work would be lost, with what would be lost', async () => {
      const alice = insertUser(database, 'alice@example.com');
      const id = insertRepository(database, alice, { name: 'Handbook' });
      const work = join(root, 'data', 'repos', String(alice), String(id));
      mkdirSync(join(root, 'data', 'repos', String(alice)), { recursive: true });
      git(root, 'clone', '-q', join(root, 'handbook.git'), work);
      writeFileSync(join(work, 'notes.md'), 'notes\n');

      const refused = await remove(alice, id).expect(409);

      expect(refused.body).toMatchObject({
        code: 'removal-needs-confirmation',
        params: { uncommittedFiles: 1, unpushedCommits: 0, stashes: 0, mergeInProgress: false, unreadable: false }
      });
      await remove(alice, id, '?confirmName=%20Handbook%20').expect(204);
    });

    it('answers another user\'s repository like a missing one', async () => {
      const alice = insertUser(database, 'alice@example.com');
      const bob = insertUser(database, 'bob@example.com');
      const secret = insertRepository(database, bob, { name: 'secret' });
      const strip = (body: Record<string, unknown>) => ({ ...body, requestId: undefined });

      const other = await remove(alice, secret, '?confirmName=secret').expect(404);
      const none = await remove(alice, secret + 100, '?confirmName=secret').expect(404);

      expect(other.body.code).toBe('not-found');
      expect(strip(other.body)).toEqual(strip(none.body));
      await http().get(`/api/v1/repositories/${secret}`).set('x-test-user', String(bob)).expect(200);
    });
  });

  describe('clone again', () => {
    const cloneAgain = (user: number, id: number) =>
      http().post(`/api/v1/repositories/${id}/clone`).set('x-test-user', String(user));

    it('clones a failed repository again and answers it cloning', async () => {
      const alice = insertUser(database, 'alice@example.com');
      const id = insertRepository(database, alice, {
        name: 'handbook',
        remoteUrl: `${server.url}/handbook.git`,
        status: 'error',
        errorCode: 'clone-failed'
      });

      const response = await cloneAgain(alice, id).expect(200);

      expect(response.body).toMatchObject({ id, name: 'handbook', status: 'cloning', error: null, warnings: [] });
      const [ job ] = database.db.select().from(jobs).where(eq(jobs.repositoryId, id)).all();
      expect(JSON.parse(job?.payload ?? '')).toEqual({ repositoryId: id, requestId: expect.any(String) });
      // The clone just queued waits for the runner (RM-7, AR-52).
      expect(response.body.clone).toEqual({ jobId: job?.id, state: 'waiting', percent: null });
    });

    it('refuses a repository that is not in error', async () => {
      const alice = insertUser(database, 'alice@example.com');
      const id = insertRepository(database, alice, { name: 'handbook' });

      const response = await cloneAgain(alice, id).expect(409);

      expect(response.body).toMatchObject({ code: 'repository-not-in-error', params: { status: 'ready' } });
    });

    it('answers another user\'s repository like a missing one', async () => {
      const alice = insertUser(database, 'alice@example.com');
      const bob = insertUser(database, 'bob@example.com');
      const secret = insertRepository(database, bob, { name: 'secret', status: 'error', errorCode: 'clone-failed' });
      const strip = (body: Record<string, unknown>) => ({ ...body, requestId: undefined });

      const other = await cloneAgain(alice, secret).expect(404);
      const none = await cloneAgain(alice, secret + 100).expect(404);

      expect(other.body.code).toBe('not-found');
      expect(strip(other.body)).toEqual(strip(none.body));
    });

    it('counts towards the access check limit', async () => {
      const alice = insertUser(database, 'alice@example.com');
      for (let i = 0; i < 10; i++) {
        await http().post('/api/v1/repositories/access-check').set('x-test-user', String(alice)).send({}).expect(400);
        await http().post('/api/v1/repositories').set('x-test-user', String(alice)).send({}).expect(400);
        await cloneAgain(alice, 999).expect(404);
      }

      const response = await cloneAgain(alice, 999).expect(429);

      expect(response.body.code).toBe('rate-limited');
    });

    it('NF-11.4: refuses a fourth clone with 429 too-many-jobs and Retry-After', async () => {
      const alice = insertUser(database, 'alice@example.com');
      // Three clones wait; scheduled far ahead, so that the runner leaves them waiting.
      for (const name of [ 'one', 'two', 'three' ]) {
        const repositoryId = insertRepository(database, alice, { name, status: 'cloning' });
        database.db.insert(jobs).values({
          type: CLONE_JOB_TYPE,
          userId: alice,
          repositoryId,
          payload: JSON.stringify({ repositoryId }),
          status: 'queued',
          runAt: new Date(Date.now() + 86_400_000),
          createdAt: new Date()
        }).run();
      }
      const id = insertRepository(database, alice, {
        name: 'handbook',
        remoteUrl: `${server.url}/handbook.git`,
        status: 'error',
        errorCode: 'clone-failed'
      });

      const response = await cloneAgain(alice, id).expect(429);

      expect(response.body.code).toBe('too-many-jobs');
      expect(response.headers['retry-after']).toBe('30');
    });
  });

  describe('warnings (RM-8)', () => {
    it('answers the stored problems in every summary', async () => {
      const alice = insertUser(database, 'alice@example.com');
      const id = insertRepository(database, alice, { name: 'handbook' });
      app.get(RemoteProblemsSource).provide(ids =>
        new Map(ids.map(repositoryId => [
          repositoryId,
          { fetch: null, push: { code: 'push-not-allowed', params: {} } }
        ]))
      );
      const as = <T extends request.Test>(test: T) => test.set('x-test-user', String(alice));

      const responses = await Promise.all([
        as(http().get('/api/v1/repositories')).expect(200),
        as(http().get('/api/v1/repositories/recent')).expect(200),
        as(http().get(`/api/v1/repositories/${id}`)).expect(200),
        as(http().post(`/api/v1/repositories/${id}/open`)).expect(200),
        as(http().get(`/api/v1/repositories/${id}/details`)).expect(200)
      ]);

      expect(responses.map(response => response.body.repositories?.[0] ?? response.body.summary ?? response.body))
        .toEqual(Array(5).fill(expect.objectContaining({ id, warnings: [ 'cannot-push' ] })));
    });

    it('answers key-locked for the session that asks', async () => {
      const alice = insertUser(database, 'alice@example.com');
      const credentials = app.get(SavedCredentialsService);
      const keyId = database.db.transaction(tx =>
        credentials.createPastedKey(tx, alice, {
          name: 'Laptop',
          privateKey: sshKeyFixture('ed25519-passphrase'),
          passphrase: FIXTURE_PASSPHRASE
        })
      );
      const id = insertRepository(database, alice, {
        name: 'handbook',
        remoteUrl: 'git@github.com:acme/handbook.git',
        credentialId: keyId
      });
      credentials.unlock(alice, 'unlocked', keyId, FIXTURE_PASSPHRASE);
      const get = (session: string) =>
        http().get(`/api/v1/repositories/${id}`).set('x-test-user', String(alice)).set('x-test-session', session);

      expect((await get('unlocked').expect(200)).body.warnings).toEqual([]);
      expect((await get('other').expect(200)).body.warnings).toEqual([ 'key-locked' ]);
    });
  });

  it('requires a login', async () => {
    await http().get('/api/v1/repositories/1/details').expect(401);
    const response = await http().get('/api/v1/repositories/recent').expect(401);
    expect(response.body.code).toBe('unauthenticated');
    await http().get('/api/v1/repositories').expect(401);
    await http().get('/api/v1/repositories/index').expect(401);
    await http().post('/api/v1/repositories/access-check').send({}).expect(401);
    await http().post('/api/v1/repositories').send({}).expect(401);
    await http().get('/api/v1/repositories/1').expect(401);
    await http().post('/api/v1/repositories/1/open').expect(401);
  });

  it('gets one repository', async () => {
    const alice = insertUser(database, 'alice@example.com');
    const id = insertRepository(database, alice, { name: 'handbook' });

    const response = await http().get(`/api/v1/repositories/${id}`).set('x-test-user', String(alice)).expect(200);

    expect(response.body).toMatchObject({ id, name: 'handbook', status: 'ready' });
  });

  it('AC-FILE-001.1: opening a ready repository moves it to the top of the recent list', async () => {
    const alice = insertUser(database, 'alice@example.com');
    const older = insertRepository(database, alice, { name: 'older', lastAccessedAt: new Date(1000) });
    insertRepository(database, alice, { name: 'newer', lastAccessedAt: new Date(2000) });
    const before = Date.now();

    const opened = await http().post(`/api/v1/repositories/${older}/open`).set('x-test-user', String(alice))
      .expect(200);

    expect(opened.body.id).toBe(older);
    expect(Date.parse(opened.body.lastAccessedAt)).toBeGreaterThanOrEqual(before - 1000);
    const recent = await http().get('/api/v1/repositories/recent').set('x-test-user', String(alice)).expect(200);
    expect(recent.body.repositories.map((r: { name: string; }) => r.name)).toEqual([ 'older', 'newer' ]);
  });

  it('does not mark a cloning repository as opened', async () => {
    const alice = insertUser(database, 'alice@example.com');
    const id = insertRepository(database, alice, { name: 'handbook', status: 'cloning' });

    const response = await http().post(`/api/v1/repositories/${id}/open`).set('x-test-user', String(alice))
      .expect(200);

    expect(response.body).toMatchObject({ status: 'cloning', lastAccessedAt: new Date(0).toISOString() });
  });

  it('answers another user\'s repository like a missing one', async () => {
    const alice = insertUser(database, 'alice@example.com');
    const bob = insertUser(database, 'bob@example.com');
    const secret = insertRepository(database, bob, { name: 'secret' });
    const missing = secret + 100;
    const strip = (body: Record<string, unknown>) => ({ ...body, requestId: undefined });

    for (const [ method, suffix ] of [ [ 'get', '' ], [ 'post', '/open' ], [ 'get', '/credentials' ] ] as const) {
      const other = await http()[method](`/api/v1/repositories/${secret}${suffix}`).set('x-test-user', String(alice));
      const none = await http()[method](`/api/v1/repositories/${missing}${suffix}`).set('x-test-user', String(alice));
      expect(other.status).toBe(404);
      expect(none.status).toBe(404);
      expect(strip(other.body)).toEqual(strip(none.body));
      expect(other.body.code).toBe('not-found');
    }
    expect(database.sqlite.prepare('select last_accessed_at from repositories where id = ?').get(secret))
      .toEqual({ last_accessed_at: 0 });
  });

  it('returns no secret', async () => {
    const alice = insertUser(database, 'alice@example.com');
    const saved = app.get(SavedCredentialsService);
    const key = database.db.transaction(tx =>
      saved.createPastedKey(tx, alice, {
        name: 'Laptop',
        privateKey: sshKeyFixture('ed25519-passphrase'),
        passphrase: FIXTURE_PASSPHRASE
      })
    );
    const https = database.db.transaction(tx =>
      saved.createHttps(tx, alice, { name: 'Work', username: 'alice', password: 'ghp_secret-token' })
    );
    const ssh = insertRepository(database, alice, {
      name: 'ssh',
      remoteUrl: 'git@github.com:acme/handbook.git',
      credentialId: key
    });
    const token = insertRepository(database, alice, { name: 'https', credentialId: https });

    for (const id of [ ssh, token ]) {
      const response = await http().get(`/api/v1/repositories/${id}/credentials`).set('x-test-user', String(alice))
        .expect(200);
      const text = JSON.stringify(response.body);
      expect(text).not.toMatch(/"(secret|privateKey|password)"/);
      expect(text).not.toContain('ghp_secret-token');
      expect(text).not.toContain('PRIVATE KEY');
    }
    const response = await http().get(`/api/v1/repositories/${ssh}/credentials`).set('x-test-user', String(alice));
    expect(response.body).toMatchObject({ protocol: 'ssh', inUse: { kind: 'ssh-key', name: 'Laptop', usedBy: 1 } });
  });

  it('refuses an id that is not a positive integer', async () => {
    const alice = insertUser(database, 'alice@example.com');
    await http().get('/api/v1/repositories/0').set('x-test-user', String(alice)).expect(400);
    await http().post('/api/v1/repositories/abc/open').set('x-test-user', String(alice)).expect(400);
  });

  it('indexes the user\'s names and remotes', async () => {
    const alice = insertUser(database, 'alice@example.com');
    insertRepository(database, alice, { name: 'Handbook' });

    const response = await http().get('/api/v1/repositories/index').set('x-test-user', String(alice)).expect(200);

    expect(response.body).toEqual({ repositories: [ { name: 'Handbook', remoteKey: 'github.com/acme/handbook' } ] });
  });

  // The broker listens on a Unix socket in a POSIX path: not on Windows.
  it.skipIf(process.platform === 'win32')('lists the branches of a remote', async () => {
    const alice = insertUser(database, 'alice@example.com');

    const response = await http().post('/api/v1/repositories/access-check').set('x-test-user', String(alice))
      .send({ remoteUrl: `${server.url}/handbook.git`, credentials: { mode: 'none' } })
      .expect(200);

    expect(response.body).toEqual({ branches: [ 'draft', 'main' ], defaultBranch: 'main' });
  });

  // The broker listens on a Unix socket in a POSIX path: not on Windows.
  it.skipIf(process.platform === 'win32')('adds a repository and answers with its summary', async () => {
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
