import { Config, ConfigModule } from '@front-burner/server-core-config';
import { CryptoModule } from '@front-burner/server-core-crypto';
import {
  Database,
  DatabaseModule,
  insertUserPreferences,
  repositories,
  userPreferences,
  users
} from '@front-burner/server-core-database';
import { EventsHub, EventsModule } from '@front-burner/server-core-events';
import { GitModule } from '@front-burner/server-core-git';
import { JobsModule } from '@front-burner/server-core-jobs';
import { ApiExceptionFilter } from '@front-burner/server-core-observability';
import { RateLimitModule, SessionLifecycleModule } from '@front-burner/server-core-security';
import { StorageModule } from '@front-burner/server-core-storage';
import { RepositoriesModule } from '@front-burner/server-feature-repositories';
import { CanActivate, ExecutionContext, INestApplication, Injectable } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import type { NextFunction, Request, Response } from 'express';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import request from 'supertest';
import { PreferencesModule } from '../preferences.module';
import { createTestDatabase } from '../testing/test-database';

@Injectable()
class StubAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    return req.auth !== undefined;
  }
}

const config = {
  dataDir: '/tmp',
  encryptionKey: 'preferences-controller-test-0123456789',
  keyUnlockIdleMs: 3_600_000,
  cloneConcurrency: 2
} as Config;

describe('CommitAuthorController', () => {
  let app: INestApplication;
  let database: Database;
  let aliceId: number;
  let bobId: number;
  let aliceRepoId: number;
  let bobRepoId: number;

  const http = () => request(app.getHttpServer());

  beforeEach(async () => {
    database = createTestDatabase();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(config),
        DatabaseModule.forRoot(database),
        CryptoModule.forRoot(config),
        StorageModule,
        GitModule.forRoot({
          helpersDir: '/tmp',
          egress: { blockPrivateNetworks: false },
          cloneTimeoutMs: 30_000,
          gitTimeoutMs: 10_000,
          knownHosts: []
        }),
        RateLimitModule,
        EventsModule,
        SessionLifecycleModule,
        JobsModule,
        RepositoriesModule,
        PreferencesModule
      ],
      providers: [
        { provide: APP_GUARD, useClass: StubAuthGuard },
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor }
      ]
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.use((req: Request, _res: Response, next: NextFunction) => {
      const userId = req.header('x-test-user');
      if (userId !== undefined) {
        req.auth = { userId: Number(userId), sessionId: 'session', authTokenExpiresAt: Number.MAX_SAFE_INTEGER };
      }
      next();
    });
    app.setGlobalPrefix('api/v1');
    await app.init();

    const alice = database.db.insert(users).values({
      email: 'alice@example.com',
      displayName: 'Alice User',
      role: 'user',
      loginMethod: 'password',
      createdAt: new Date()
    }).returning().get();
    aliceId = alice.id;
    insertUserPreferences(database.db, alice);

    const bob = database.db.insert(users).values({
      email: 'bob@example.com',
      displayName: 'Bob User',
      role: 'user',
      loginMethod: 'password',
      createdAt: new Date()
    }).returning().get();
    bobId = bob.id;
    insertUserPreferences(database.db, bob);

    const repoA = database.db.insert(repositories).values({
      userId: aliceId,
      name: 'alice-repo',
      remoteUrl: 'https://example.com/alice.git',
      cloneMode: 'full',
      gitLevel: 'advanced',
      status: 'ready',
      createdAt: new Date(),
      lastAccessedAt: new Date()
    }).returning().get();
    aliceRepoId = repoA.id;

    const repoB = database.db.insert(repositories).values({
      userId: bobId,
      name: 'bob-repo',
      remoteUrl: 'https://example.com/bob.git',
      cloneMode: 'full',
      gitLevel: 'advanced',
      status: 'ready',
      createdAt: new Date(),
      lastAccessedAt: new Date()
    }).returning().get();
    bobRepoId = repoB.id;
  });

  afterEach(async () => {
    await app.close();
    database.sqlite.close();
  });

  it('refuses unauthenticated requests', async () => {
    await http().get('/api/v1/preferences/commit-author').expect(403);
    await http().put('/api/v1/preferences/commit-author').send({ name: 'A', email: 'a@b.com' }).expect(403);
    await http().post('/api/v1/preferences/commit-author/confirm').expect(403);
    await http().get(`/api/v1/repositories/${aliceRepoId}/commit-author`).expect(403);
    await http().put(`/api/v1/repositories/${aliceRepoId}/commit-author`).send({ name: 'A', email: 'a@b.com' }).expect(
      403
    );
    await http().delete(`/api/v1/repositories/${aliceRepoId}/commit-author`).expect(403);
  });

  it('refuses a bad author next to the field', async () => {
    const res = await http()
      .put('/api/v1/preferences/commit-author')
      .set('x-test-user', String(aliceId))
      .send({
        name: '<Invalid>',
        email: 'bad-email'
      })
      .expect(400);

    expect(res.body.code).toBe('validation-failed');
    expect(res.body.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'name', code: 'name-invalid' }),
        expect.objectContaining({ path: 'email', code: 'email-invalid' })
      ])
    );
  });

  it('answers a missing field with its required code', async () => {
    const res = await http()
      .put('/api/v1/preferences/commit-author')
      .set('x-test-user', String(aliceId))
      .send({})
      .expect(400);

    expect(res.body.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'name', code: 'name-required' }),
        expect.objectContaining({ path: 'email', code: 'email-required' })
      ])
    );
  });

  describe('a stored default that breaks CA-10', () => {
    const bad = { name: 'Carol <Ops>', email: 'not an email' };

    beforeEach(() => {
      database.db.update(userPreferences)
        .set({ commitAuthorName: bad.name, commitAuthorEmail: bad.email })
        .where(eq(userPreferences.userId, aliceId))
        .run();
    });

    it('reads a stored default that breaks CA-10', async () => {
      const user = String(aliceId);
      const preference = await http().get('/api/v1/preferences/commit-author').set('x-test-user', user).expect(200);
      expect(preference.body).toEqual({ author: bad, confirmed: false });

      const url = `/api/v1/repositories/${aliceRepoId}/commit-author`;
      const repository = await http().get(url).set('x-test-user', user).expect(200);
      expect(repository.body).toEqual({ author: bad, source: 'default', confirmed: false });

      const removed = await http().delete(url).set('x-test-user', user).expect(200);
      expect(removed.body).toEqual({ author: bad, source: 'default', confirmed: false });
    });

    it('refuses to confirm it, next to the fields, until it is changed', async () => {
      const user = String(aliceId);
      const refused = await http().post('/api/v1/preferences/commit-author/confirm').set('x-test-user', user).expect(
        400
      );
      expect(refused.body.code).toBe('validation-failed');
      expect(refused.body.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: 'name', code: 'name-invalid' }),
          expect.objectContaining({ path: 'email', code: 'email-invalid' })
        ])
      );
      const after = await http().get('/api/v1/preferences/commit-author').set('x-test-user', user).expect(200);
      expect(after.body.confirmed).toBe(false);

      await http()
        .put('/api/v1/preferences/commit-author')
        .set('x-test-user', user)
        .send({ name: 'Carol', email: 'carol@example.com' })
        .expect(200);
      await http().post('/api/v1/preferences/commit-author/confirm').set('x-test-user', user).expect(204);
    });
  });

  it('AC-GIT-001.11: another user can neither read nor change a commit author', async () => {
    // Bob trying to read Alice's repo commit author
    await http()
      .get(`/api/v1/repositories/${aliceRepoId}/commit-author`)
      .set('x-test-user', String(bobId))
      .expect(404);

    // Bob trying to change Alice's repo commit author
    await http()
      .put(`/api/v1/repositories/${aliceRepoId}/commit-author`)
      .set('x-test-user', String(bobId))
      .send({ name: 'Bob Hacker', email: 'bob@hack.org' })
      .expect(404);

    // Bob trying to delete Alice's repo commit author
    await http()
      .delete(`/api/v1/repositories/${aliceRepoId}/commit-author`)
      .set('x-test-user', String(bobId))
      .expect(404);
  });

  it('reads, updates, and confirms preferences', async () => {
    const getRes = await http()
      .get('/api/v1/preferences/commit-author')
      .set('x-test-user', String(aliceId))
      .expect(200);

    expect(getRes.body).toEqual({
      author: {
        name: 'Alice User',
        email: 'alice@example.com'
      },
      confirmed: false
    });

    await http()
      .post('/api/v1/preferences/commit-author/confirm')
      .set('x-test-user', String(aliceId))
      .expect(204);

    const afterConfirm = await http()
      .get('/api/v1/preferences/commit-author')
      .set('x-test-user', String(aliceId))
      .expect(200);

    expect(afterConfirm.body.confirmed).toBe(true);

    const updateRes = await http()
      .put('/api/v1/preferences/commit-author')
      .set('x-test-user', String(aliceId))
      .send({ name: 'Alice In Chains', email: 'alice@music.org' })
      .expect(200);

    expect(updateRes.body).toEqual({
      author: {
        name: 'Alice In Chains',
        email: 'alice@music.org'
      },
      confirmed: true
    });
  });

  it('publishes git.changed after an override changes, so that every tab shows the author', async () => {
    const publish = vi.spyOn(app.get(EventsHub), 'publish');
    const author = { name: 'Alice Work', email: 'alice@work.example' };

    await http().put(`/api/v1/repositories/${aliceRepoId}/commit-author`)
      .set('x-test-user', String(aliceId)).send(author).expect(200);
    expect(publish).toHaveBeenCalledExactlyOnceWith(aliceId, { type: 'git.changed', repositoryId: aliceRepoId });

    publish.mockClear();
    await http().delete(`/api/v1/repositories/${aliceRepoId}/commit-author`)
      .set('x-test-user', String(aliceId)).expect(200);
    expect(publish).toHaveBeenCalledExactlyOnceWith(aliceId, { type: 'git.changed', repositoryId: aliceRepoId });
  });

  it('publishes nothing when another user\'s override is refused', async () => {
    const publish = vi.spyOn(app.get(EventsHub), 'publish');

    await http().put(`/api/v1/repositories/${aliceRepoId}/commit-author`)
      .set('x-test-user', String(bobId)).send({ name: 'Bob', email: 'bob@example.com' }).expect(404);

    expect(publish).not.toHaveBeenCalled();
  });

  it('manages repository overrides over the API', async () => {
    const repoRes = await http()
      .get(`/api/v1/repositories/${aliceRepoId}/commit-author`)
      .set('x-test-user', String(aliceId))
      .expect(200);

    expect(repoRes.body).toEqual({
      author: {
        name: 'Alice User',
        email: 'alice@example.com'
      },
      source: 'default',
      confirmed: false
    });

    const putRes = await http()
      .put(`/api/v1/repositories/${aliceRepoId}/commit-author`)
      .set('x-test-user', String(aliceId))
      .send({ name: 'Alice Work', email: 'alice@work.corp' })
      .expect(200);

    expect(putRes.body).toEqual({
      author: {
        name: 'Alice Work',
        email: 'alice@work.corp'
      },
      source: 'override',
      confirmed: false
    });

    const delRes = await http()
      .delete(`/api/v1/repositories/${aliceRepoId}/commit-author`)
      .set('x-test-user', String(aliceId))
      .expect(200);

    expect(delRes.body).toEqual({
      author: {
        name: 'Alice User',
        email: 'alice@example.com'
      },
      source: 'default',
      confirmed: false
    });
  });
});
