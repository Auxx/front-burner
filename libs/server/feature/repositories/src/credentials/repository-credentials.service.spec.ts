import type { Config } from '@front-burner/server-core-config';
import { SecretBox } from '@front-burner/server-core-crypto';
import { Database, repositories, savedCredentials } from '@front-burner/server-core-database';
import { EventsHub } from '@front-burner/server-core-events';
import { GitEngine, GitRunner } from '@front-burner/server-core-git';
import {
  FIXTURE_PASSPHRASE,
  GitHttpServer,
  GitHttpServerOptions,
  sshKeyFixture,
  startGitHttpServer
} from '@front-burner/server-core-git/testing';
import { SessionLifecycle } from '@front-burner/server-core-security';
import {
  KeyUnlockStore,
  KnownHostsService,
  SavedCredentialsService,
  UnlockAttempts
} from '@front-burner/server-feature-credentials';
import { NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialsCheck } from '../add/credentials-check';
import { RequestCredentials } from '../add/request-credentials';
import { RepositoryQueries } from '../repositories/repository-queries';
import { insertRepository, insertUser } from '../testing/fixtures';
import { createRemotes, testGitOptions, trustTestCertificate } from '../testing/git-fixtures';
import { createTestDatabase } from '../testing/test-database';
import { RepositoryCredentialsService } from './repository-credentials.service';

const IDLE = 60 * 60_000;
const box = new SecretBox('repository-credentials-spec-key-0123456789');
const SSH_REMOTE = 'git@github.com:acme/handbook.git';
const OLD_TOKEN = 'ghp_old-expired-token';
const NEW_TOKEN = 'ghp_new-fresh-token';

const fieldError = (path: string, code: string, params: Record<string, unknown> = {}) =>
  expect.objectContaining({ code: 'validation-failed', fields: [ { path, code, params } ] });

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('did not fail');
}

describe('RepositoryCredentialsService', () => {
  let restoreCa: () => void;
  let root: string;
  let server: GitHttpServer;
  let serverOptions: GitHttpServerOptions;
  let database: Database;
  let unlocks: KeyUnlockStore;
  let saved: SavedCredentialsService;
  let engine: GitEngine;
  let service: RepositoryCredentialsService;
  let alice: number;
  let bob: number;

  const createKey = (userId = alice, name = 'Laptop') =>
    database.db.transaction(tx =>
      saved.createPastedKey(tx, userId, {
        name,
        privateKey: sshKeyFixture('ed25519-passphrase'),
        passphrase: FIXTURE_PASSPHRASE
      })
    );
  const createHttps = (userId = alice, name = 'Work', password = 'ghp_secret-token') =>
    database.db.transaction(tx => saved.createHttps(tx, userId, { name, username: 'alice', password }));
  const handbookUrl = () => `${server.url}/handbook.git`;
  const user = (id = alice) => ({ id, sessionId: 's1' });
  const all = () => ({
    repositories: database.db.select().from(repositories).all(),
    credentials: database.db.select().from(savedCredentials).all()
  });

  beforeAll(() => {
    restoreCa = trustTestCertificate();
  });

  afterAll(() => {
    restoreCa();
  });

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'fb-repository-credentials-'));
    const { handbook } = createRemotes(root);
    serverOptions = { repositories: { 'handbook.git': handbook }, users: { alice: NEW_TOKEN } };
    server = await startGitHttpServer(serverOptions);
    database = createTestDatabase();
    unlocks = new KeyUnlockStore({ keyUnlockIdleMs: IDLE } as Config, new SessionLifecycle(), new EventsHub());
    saved = new SavedCredentialsService(database, box, unlocks, new UnlockAttempts());
    const gitOptions = testGitOptions();
    engine = new GitEngine(gitOptions, new GitRunner());
    service = new RepositoryCredentialsService(
      database,
      new RepositoryQueries(database),
      saved,
      new RequestCredentials(saved, unlocks),
      new CredentialsCheck(database, saved, new KnownHostsService(database, gitOptions), engine, unlocks)
    );
    alice = insertUser(database, 'alice@x.io');
    bob = insertUser(database, 'bob@x.io');
  });

  afterEach(async () => {
    unlocks.onModuleDestroy();
    await server.close();
    database.sqlite.close();
    rmSync(root, { recursive: true, force: true });
    vi.useRealTimers();
  });

  it('reports the credentials in use, and how many repositories use them', () => {
    const https = createHttps();
    const id = insertRepository(database, alice, { name: 'handbook', credentialId: https });
    insertRepository(database, alice, { name: 'wiki', credentialId: https });
    insertRepository(database, alice, { name: 'other' });
    // Bob's repositories are not counted, whatever their credential ID.
    insertRepository(database, bob, { name: 'handbook', credentialId: https });

    expect(service.get(alice, 's1', id)).toEqual({
      protocol: 'https',
      inUse: { kind: 'https', id: https, name: 'Work', username: 'alice', missing: false, usedBy: 2 }
    });
  });

  it('reports a key as locked in this session and unlocked in another', () => {
    const key = createKey();
    const id = insertRepository(database, alice, { name: 'handbook', remoteUrl: SSH_REMOTE, credentialId: key });
    saved.unlock(alice, 's2', key, FIXTURE_PASSPHRASE);

    expect(service.get(alice, 's1', id)).toEqual({
      protocol: 'ssh',
      inUse: {
        kind: 'ssh-key',
        id: key,
        name: 'Laptop',
        keyType: 'ed25519',
        fingerprint: expect.stringMatching(/^SHA256:/),
        passphraseProtected: true,
        unlocked: false,
        generated: false,
        missing: false,
        usedBy: 1
      }
    });
    expect(service.get(alice, 's2', id).inUse).toMatchObject({ unlocked: true });
  });

  it('reports none for a public repository', () => {
    const id = insertRepository(database, alice, { name: 'handbook' });

    expect(service.get(alice, 's1', id)).toEqual({ protocol: 'https', inUse: null });
  });

  it('does not restart the idle timer', () => {
    vi.useFakeTimers({ toFake: [ 'setTimeout', 'clearTimeout' ] });
    const key = createKey();
    const id = insertRepository(database, alice, { name: 'handbook', remoteUrl: SSH_REMOTE, credentialId: key });
    saved.unlock(alice, 's1', key, FIXTURE_PASSPHRASE);

    vi.advanceTimersByTime(IDLE - 1000);
    expect(service.get(alice, 's1', id).inUse).toMatchObject({ unlocked: true });
    vi.advanceTimersByTime(1000);

    expect(service.get(alice, 's1', id).inUse).toMatchObject({ unlocked: false });
  });

  it('reports credentials whose secret an encryption key reset deleted as missing', () => {
    const key = createKey();
    const id = insertRepository(database, alice, { name: 'handbook', remoteUrl: SSH_REMOTE, credentialId: key });
    database.db.update(savedCredentials).set({ secret: null }).run();

    expect(service.get(alice, 's1', id).inUse).toMatchObject({ passphraseProtected: true, missing: true });
  });

  it('answers another user\'s repository like a missing one', () => {
    const id = insertRepository(database, bob, { name: 'handbook', credentialId: createHttps(bob) });

    expect(() => service.get(alice, 's1', id)).toThrow(expect.objectContaining({ code: 'not-found' }));
    expect(() => service.get(alice, 's1', 9999)).toThrow(expect.objectContaining({ code: 'not-found' }));
  });

  // The broker listens on a Unix socket in a POSIX path: not on Windows.
  describe.skipIf(process.platform === 'win32')('replacing a repository\'s credentials (RC-8)', () => {
    it('uses new credentials after the check passes, and saves them', async () => {
      const id = insertRepository(database, alice, { name: 'handbook', remoteUrl: handbookUrl() });

      const info = await service.replace(user(), id, {
        mode: 'new-https',
        name: 'GitHub work',
        username: 'alice',
        password: NEW_TOKEN
      });

      const { repositories: [ row ], credentials: [ credential ] } = all();
      expect(credential).toMatchObject({ userId: alice, kind: 'https', name: 'GitHub work', username: 'alice' });
      expect(row?.credentialId).toBe(credential?.id);
      expect(info).toEqual({
        protocol: 'https',
        inUse: { kind: 'https', id: credential?.id, name: 'GitHub work', username: 'alice', missing: false, usedBy: 1 }
      });
      expect(saved.resolveForJob(alice, credential?.id ?? 0, undefined)).toMatchObject({ password: NEW_TOKEN });
    });

    it('AC-REPO-002.6: replacing keeps the old saved credentials, and other repositories keep working', async () => {
      const shared = createHttps(alice, 'Shared', NEW_TOKEN);
      const id = insertRepository(database, alice, {
        name: 'handbook',
        remoteUrl: handbookUrl(),
        credentialId: shared
      });
      const other = insertRepository(database, alice, { name: 'wiki', remoteUrl: handbookUrl(), credentialId: shared });
      const replacement = createHttps(alice, 'Personal', NEW_TOKEN);

      await service.replace(user(), id, { mode: 'saved', credentialId: replacement });

      expect(all().credentials.map(row => row.name)).toEqual([ 'Shared', 'Personal' ]);
      expect(service.get(alice, 's1', id).inUse).toMatchObject({ id: replacement, usedBy: 1 });
      expect(service.get(alice, 's1', other).inUse).toMatchObject({ id: shared, usedBy: 1 });
      const credentials = saved.resolveForJob(alice, shared, undefined);
      await expect(engine.accessCheck(handbookUrl(), credentials, [])).resolves.toMatchObject({
        defaultBranch: 'main'
      });
    });

    it('removes the credentials of a public repository', async () => {
      const work = createHttps();
      const id = insertRepository(database, alice, { name: 'handbook', remoteUrl: handbookUrl(), credentialId: work });
      serverOptions.users = undefined;

      expect(await service.replace(user(), id, { mode: 'none' })).toEqual({ protocol: 'https', inUse: null });
      expect(all().credentials).toHaveLength(1);
    });

    it('a failed check changes nothing', async () => {
      const old = createHttps(alice, 'Old', OLD_TOKEN);
      const id = insertRepository(database, alice, { name: 'handbook', remoteUrl: handbookUrl(), credentialId: old });
      const before = all();

      const error = await rejectionOf(
        service.replace(user(), id, { mode: 'new-https', name: 'New', username: 'alice', password: 'wrong' })
      );

      expect(error).toEqual(fieldError('credentials', 'credentials-refused', { generatedKey: false }));
      expect(all()).toEqual(before);
    });

    it('refuses credentials that do not fit the remote\'s protocol', async () => {
      const id = insertRepository(database, alice, { name: 'handbook', remoteUrl: SSH_REMOTE });

      for (
        const credentials of [
          { mode: 'none' as const },
          { mode: 'new-https' as const, name: 'New', username: 'alice', password: NEW_TOKEN }
        ]
      ) {
        // As the Add repository page's schema answers.
        expect(await rejectionOf(service.replace(user(), id, credentials))).toEqual(
          fieldError('credentials', 'protocol-mismatch')
        );
      }
      // Saved credentials of the other kind, as RequestCredentials answers when adding.
      expect(await rejectionOf(service.replace(user(), id, { mode: 'saved', credentialId: createHttps() }))).toEqual(
        fieldError('credentials', 'kind-mismatch')
      );
      expect(all().repositories[0]?.credentialId).toBeNull();
    });

    it('refuses another user\'s saved credentials', async () => {
      const id = insertRepository(database, alice, { name: 'handbook', remoteUrl: handbookUrl() });
      const bobs = createHttps(bob, 'Work', NEW_TOKEN);

      const theirs = await rejectionOf(service.replace(user(), id, { mode: 'saved', credentialId: bobs }));
      const missing = await rejectionOf(service.replace(user(), id, { mode: 'saved', credentialId: 9999 }));

      // The same answer as for an ID that does not exist.
      expect(theirs).toBeInstanceOf(NotFoundException);
      expect(missing).toBeInstanceOf(NotFoundException);
      expect((theirs as NotFoundException).getResponse()).toEqual((missing as NotFoundException).getResponse());
      expect(all().repositories[0]?.credentialId).toBeNull();
    });

    it('refuses a taken name before contacting the remote', async () => {
      createHttps(alice, 'work');
      const id = insertRepository(database, alice, { name: 'handbook', remoteUrl: handbookUrl() });
      await server.close();

      const error = await rejectionOf(
        service.replace(user(), id, { mode: 'new-https', name: 'Work', username: 'alice', password: NEW_TOKEN })
      );

      expect(error).toEqual(fieldError('credentials.name', 'name-taken'));
    });

    it('refuses a repository that is still cloning', async () => {
      const id = insertRepository(database, alice, { name: 'handbook', remoteUrl: handbookUrl(), status: 'cloning' });

      const replacing = await rejectionOf(service.replace(user(), id, { mode: 'none' }));
      const updating = await rejectionOf(service.updateToken(user(), id, { username: 'alice', password: NEW_TOKEN }));

      for (const error of [ replacing, updating ]) {
        expect(error).toMatchObject({ status: 409, code: 'repository-not-openable', params: { status: 'cloning' } });
      }
    });

    it('replaces the credentials of a repository whose clone failed, for a retry', async () => {
      const old = createHttps(alice, 'Old', OLD_TOKEN);
      const id = insertRepository(database, alice, {
        name: 'handbook',
        remoteUrl: handbookUrl(),
        credentialId: old,
        status: 'error',
        errorCode: 'clone-failed'
      });
      const fresh = createHttps(alice, 'Fresh', NEW_TOKEN);

      await service.replace(user(), id, { mode: 'saved', credentialId: fresh });

      expect(all().repositories[0]).toMatchObject({ credentialId: fresh, status: 'error' });
    });

    it('answers another user\'s repository like a missing one', async () => {
      const id = insertRepository(database, bob, { name: 'handbook', remoteUrl: handbookUrl() });

      expect(await rejectionOf(service.replace(user(), id, { mode: 'none' }))).toMatchObject({ code: 'not-found' });
      expect(await rejectionOf(service.updateToken(user(), id, { username: 'a', password: 'b' }))).toMatchObject({
        code: 'not-found'
      });
    });
  });

  // The broker listens on a Unix socket in a POSIX path: not on Windows.
  describe.skipIf(process.platform === 'win32')('updating a saved token (RC-13)', () => {
    let work: number;
    let handbook: number;
    let wiki: number;

    beforeEach(() => {
      work = createHttps(alice, 'GitHub work', OLD_TOKEN);
      handbook = insertRepository(database, alice, { name: 'handbook', remoteUrl: handbookUrl(), credentialId: work });
      wiki = insertRepository(database, alice, { name: 'wiki', remoteUrl: handbookUrl(), credentialId: work });
    });

    it('a push after the update uses the new token', async () => {
      serverOptions.users = { alice2: NEW_TOKEN };

      const info = await service.updateToken(user(), handbook, { username: 'alice2', password: NEW_TOKEN });

      expect(info.inUse).toEqual({
        kind: 'https',
        id: work,
        name: 'GitHub work',
        username: 'alice2',
        missing: false,
        usedBy: 2
      });
      // A push job reads its repository's credentials when it runs (RC-19): every repository that uses them.
      for (const id of [ handbook, wiki ]) {
        const row = all().repositories.find(repository => repository.id === id);
        expect(saved.resolveForJob(alice, row?.credentialId ?? 0, undefined)).toEqual({
          kind: 'https',
          username: 'alice2',
          password: NEW_TOKEN
        });
      }
    });

    it('an update whose access check fails changes nothing', async () => {
      const before = all();

      const error = await rejectionOf(service.updateToken(user(), handbook, { username: 'alice', password: 'wrong' }));

      expect(error).toEqual(fieldError('credentials', 'credentials-refused', { generatedKey: false }));
      // Byte for byte: not even encrypted again.
      expect(all()).toEqual(before);
    });

    it('refuses to update credentials the repository was given while the check ran', async () => {
      const other = createHttps(alice, 'Other', NEW_TOKEN);
      const before = all().credentials;
      const check = vi.spyOn(GitEngine.prototype, 'accessCheck').mockImplementationOnce(async () => {
        // Another tab replaces the repository's credentials meanwhile.
        database.db.update(repositories).set({ credentialId: other }).where(eq(repositories.id, handbook)).run();
        return { branches: [ 'main' ], defaultBranch: 'main' };
      });

      try {
        expect(await rejectionOf(service.updateToken(user(), handbook, { username: 'alice', password: NEW_TOKEN })))
          .toMatchObject({ status: 409, code: 'credentials-not-updatable' });
      } finally {
        check.mockRestore();
      }
      expect(all().credentials).toEqual(before);
    });

    it('refuses to update an SSH key or a repository without credentials', async () => {
      const key = createKey();
      const ssh = insertRepository(database, alice, { name: 'ssh', remoteUrl: SSH_REMOTE, credentialId: key });
      const none = insertRepository(database, alice, { name: 'public', remoteUrl: handbookUrl() });
      const before = all();

      for (const id of [ ssh, none ]) {
        expect(await rejectionOf(service.updateToken(user(), id, { username: 'alice', password: NEW_TOKEN })))
          .toMatchObject({ status: 409, code: 'credentials-not-updatable' });
      }
      expect(all()).toEqual(before);
    });

    it('no response contains the token', async () => {
      const responses = [
        await service.updateToken(user(), handbook, { username: 'alice', password: NEW_TOKEN }),
        await service.replace(user(), wiki, { mode: 'new-https', name: 'New', username: 'alice', password: NEW_TOKEN }),
        service.get(alice, 's1', handbook)
      ];

      const text = JSON.stringify(responses);
      expect(text).not.toContain(NEW_TOKEN);
      expect(text).not.toContain(OLD_TOKEN);
      expect(text).not.toContain('fb1.');
    });
  });
});
