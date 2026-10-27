import { Config, ConfigModule } from '@front-burner/server-core-config';
import { CryptoModule } from '@front-burner/server-core-crypto';
import { Database, DatabaseModule, knownHosts } from '@front-burner/server-core-database';
import { GIT_OPTIONS } from '@front-burner/server-core-git';
import { FIXTURE_PASSPHRASE, sshKeyFixture } from '@front-burner/server-core-git/testing';
import { ApiErrorException, ApiExceptionFilter } from '@front-burner/server-core-observability';
import { RATE_LIMIT_GROUP, SessionLifecycleModule } from '@front-burner/server-core-security';
import { CanActivate, ExecutionContext, Global, INestApplication, Injectable, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import request from 'supertest';
import { CredentialsModule } from '../credentials.module';
import { insertUser } from '../testing/fixtures';
import { createTestDatabase } from '../testing/test-database';
import { CredentialsController } from './credentials.controller';
import { SavedCredentialsService } from './saved-credentials.service';

const ED25519 = 'AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl';
const OTHER_ED25519 = 'AAAAC3NzaC1lZDI1NTE5AAAAIIazEu89wgQZ4bqs3d63QSMzYVa0MuJ2e2gKTKqu+UUO';

const config = {
  encryptionKey: 'credentials-controller-spec-key-0123456789',
  keyUnlockIdleMs: 3_600_000
} as Config;

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

/** Stands in for the global git module's options. */
@Global()
@Module({ providers: [ { provide: GIT_OPTIONS, useValue: { knownHosts: [] } } ], exports: [ GIT_OPTIONS ] })
class StubGitModule {}

describe('credentials endpoints', () => {
  let app: INestApplication;
  let database: Database;
  let service: SavedCredentialsService;
  let alice: number;
  let bob: number;

  /** A request as a user in a session, as the auth middleware would set it. */
  const as = (userId: number, session = 'session-1') => ({ 'x-test-user': String(userId), 'x-test-session': session });
  const seedKey = (userId: number, name = 'Laptop') =>
    database.db.transaction(tx =>
      service.createPastedKey(tx, userId, {
        name,
        privateKey: sshKeyFixture('ed25519-passphrase'),
        passphrase: FIXTURE_PASSPHRASE
      })
    );

  beforeEach(async () => {
    database = createTestDatabase();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(config),
        DatabaseModule.forRoot(database),
        CryptoModule.forRoot(config),
        SessionLifecycleModule,
        StubGitModule,
        CredentialsModule
      ],
      providers: [
        { provide: APP_GUARD, useClass: StubAuthGuard },
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor }
      ]
    }).compile();
    app = moduleRef.createNestApplication();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      const userId = req.header('x-test-user');
      if (userId !== undefined) {
        req.auth = {
          userId: Number(userId),
          sessionId: req.header('x-test-session') ?? 'session-1',
          authTokenExpiresAt: Number.MAX_SAFE_INTEGER
        };
      }
      next();
    });
    app.setGlobalPrefix('api/v1');
    await app.init();
    service = app.get(SavedCredentialsService);
    alice = insertUser(database, 'alice@x.io');
    bob = insertUser(database, 'bob@x.io');
  });

  afterEach(async () => {
    await app.close();
    database.sqlite.close();
  });

  it('needs a login', async () => {
    await request(app.getHttpServer()).get('/api/v1/credentials').expect(401);
  });

  it('lists only the user\'s credentials', async () => {
    const key = seedKey(alice);
    seedKey(bob, 'Bob\'s key');
    database.db.transaction(tx => service.createHttps(tx, bob, { name: 'Work', username: 'bob', password: 'secret' }));

    const response = await request(app.getHttpServer()).get('/api/v1/credentials').set(as(alice)).expect(200);

    expect(response.body).toEqual({
      https: [],
      sshKeys: [ {
        id: key,
        name: 'Laptop',
        keyType: 'ed25519',
        fingerprint: expect.stringMatching(/^SHA256:/),
        passphraseProtected: true,
        unlocked: false,
        generated: false,
        missing: false
      } ]
    });
  });

  it('generates a key with the instance host as comment', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/credentials/ssh-keys/generate')
      .set(as(alice))
      .set('Host', 'fb.example.com:8443')
      .send({ name: ' Deploy key ' })
      .expect(201);

    expect(response.body).toEqual({
      key: expect.objectContaining({ name: 'Deploy key', generated: true, passphraseProtected: false }),
      publicKey: expect.stringMatching(/^ssh-ed25519 \S+ front-burner@fb\.example\.com$/)
    });
    expect(JSON.stringify(response.body)).not.toContain('PRIVATE KEY');
  });

  it('refuses a taken name for a generated key', async () => {
    seedKey(alice, 'Deploy');
    const response = await request(app.getHttpServer())
      .post('/api/v1/credentials/ssh-keys/generate')
      .set(as(alice))
      .send({ name: 'deploy' })
      .expect(400);
    expect(response.body.fields).toEqual([ { path: 'name', code: 'name-taken', params: {} } ]);
  });

  it('unlocks a key and reports it unlocked in the same session only', async () => {
    const key = seedKey(alice);

    await request(app.getHttpServer())
      .post(`/api/v1/credentials/ssh-keys/${key}/unlock`)
      .set(as(alice))
      .send({ passphrase: FIXTURE_PASSPHRASE })
      .expect(204);

    const same = await request(app.getHttpServer()).get('/api/v1/credentials').set(as(alice)).expect(200);
    const other = await request(app.getHttpServer()).get('/api/v1/credentials').set(as(alice, 'session-2'))
      .expect(200);
    expect(same.body.sshKeys[0].unlocked).toBe(true);
    expect(other.body.sshKeys[0].unlocked).toBe(false);
  });

  it('reports a wrong passphrase on the field', async () => {
    const key = seedKey(alice);

    const response = await request(app.getHttpServer())
      .post(`/api/v1/credentials/ssh-keys/${key}/unlock`)
      .set(as(alice))
      .send({ passphrase: 'wrong' })
      .expect(400);

    expect(response.body).toMatchObject({
      code: 'validation-failed',
      fields: [ { path: 'passphrase', code: 'wrong-passphrase', params: {} } ]
    });
  });

  it('answers 404 for another user\'s credential', async () => {
    const bobs = seedKey(bob);
    const unlock = (id: number | string) =>
      request(app.getHttpServer())
        .post(`/api/v1/credentials/ssh-keys/${id}/unlock`)
        .set(as(alice))
        .send({ passphrase: FIXTURE_PASSPHRASE })
        .expect(404);

    const other = await unlock(bobs);
    const unknown = await unlock(bobs + 1000);

    const without = (record: Record<string, unknown>, ...keys: string[]) =>
      Object.fromEntries(Object.entries(record).filter(([ key ]) => !keys.includes(key)));
    expect(other.body.code).toBe('not-found');
    expect(without(other.body, 'requestId')).toEqual(without(unknown.body, 'requestId'));
    // The ETag hashes the body, which differs only by its request ID.
    const headers = (response: request.Response) => without(response.headers, 'x-request-id', 'date', 'etag');
    expect(headers(other)).toEqual(headers(unknown));
  });

  it('limits passphrase attempts, which run the key\'s KDF', () => {
    expect(Reflect.getMetadata(RATE_LIMIT_GROUP, CredentialsController.prototype.unlockSshKey)).toBe('ssh-key-unlock');
  });

  it('answers 404 for a non-numeric ID', async () => {
    for (const id of [ 'abc', '0', '-1', '1.5', '1e3', '99999999999999999999' ]) {
      const response = await request(app.getHttpServer())
        .post(`/api/v1/credentials/ssh-keys/${id}/unlock`)
        .set(as(alice))
        .send({ passphrase: 'x' });
      expect(response.status).toBe(404);
      expect(response.body.code).toBe('not-found');
    }
  });

  it('trusts a host', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/known-hosts')
      .set(as(alice))
      .send({ host: 'git.example.com', port: 22, type: 'ssh-ed25519', key: ED25519 })
      .expect(204);

    expect(database.db.select().from(knownHosts).all()).toEqual([
      expect.objectContaining({ userId: alice, host: 'git.example.com', port: 22 })
    ]);
  });

  it('refuses to replace a trusted host key', async () => {
    const trust = (key: string) =>
      request(app.getHttpServer())
        .post('/api/v1/known-hosts')
        .set(as(alice))
        .send({ host: 'git.example.com', port: 22, type: 'ssh-ed25519', key });
    await trust(ED25519).expect(204);
    const response = await trust(OTHER_ED25519).expect(409);
    expect(response.body.code).toBe('host-key-changed');
  });

  it('refuses a host name that would match more hosts than one', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/known-hosts')
      .set(as(alice))
      .send({ host: 'github.com,evil.example.com', port: 22, type: 'ssh-ed25519', key: ED25519 })
      .expect(400);
    expect(response.body.code).toBe('validation-failed');
    expect(database.db.select().from(knownHosts).all()).toEqual([]);
  });
});
