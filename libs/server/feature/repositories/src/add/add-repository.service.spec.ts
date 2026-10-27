import type { Config } from '@front-burner/server-core-config';
import { SecretBox } from '@front-burner/server-core-crypto';
import { Database, jobs, repositories, savedCredentials, users } from '@front-burner/server-core-database';
import type { EventsHub } from '@front-burner/server-core-events';
import { GitEngine, GitRunner, UnlockedKey } from '@front-burner/server-core-git';
import {
  FIXTURE_PASSPHRASE,
  GitHttpServer,
  sshKeyFixture,
  startGitHttpServer
} from '@front-burner/server-core-git/testing';
import { JobRunner } from '@front-burner/server-core-jobs';
import { SessionLifecycle } from '@front-burner/server-core-security';
import { KeyUnlockStore, KnownHostsService, SavedCredentialsService } from '@front-burner/server-feature-credentials';
import type { AddRepositoryRequest } from '@front-burner/shared-contracts';
import { eq } from 'drizzle-orm';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CloneKeys } from '../clone/clone-keys';
import { insertRepository, insertUser } from '../testing/fixtures';
import { createRemotes, testGitOptions, trustTestCertificate } from '../testing/git-fixtures';
import { createTestDatabase } from '../testing/test-database';
import { AddRepositoryService } from './add-repository.service';
import { RequestCredentials } from './request-credentials';

const box = new SecretBox('add-repository-spec-key-0123456789abcdef');
const SESSION = 'session-1';
const TOKEN = 'ghp_s3cret-token';

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

describe('AddRepositoryService', () => {
  let restoreCa: () => void;
  let root: string;
  let server: GitHttpServer;
  let database: Database;
  let unlocks: KeyUnlockStore;
  let saved: SavedCredentialsService;
  let runner: JobRunner;
  let cloneKeys: CloneKeys;
  let service: AddRepositoryService;
  let alice: { id: number; sessionId: string; };

  const handbookUrl = () => `${server.url}/handbook.git`;
  const request = (overrides: Partial<AddRepositoryRequest> = {}): AddRepositoryRequest => ({
    remoteUrl: handbookUrl(),
    name: 'Handbook',
    credentials: { mode: 'none' },
    cloneMode: 'full',
    ...overrides
  });
  const all = () => ({
    repositories: database.db.select().from(repositories).all(),
    credentials: database.db.select().from(savedCredentials).all(),
    jobs: database.db.select().from(jobs).all()
  });

  async function serve(users?: Record<string, string>): Promise<void> {
    await server?.close();
    const remotes = { handbook: join(root, 'handbook.git'), empty: join(root, 'empty.git') };
    server = await startGitHttpServer({
      repositories: { 'handbook.git': remotes.handbook, 'empty.git': remotes.empty },
      users
    });
  }

  beforeAll(() => {
    restoreCa = trustTestCertificate();
  });

  afterAll(() => {
    restoreCa();
  });

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'fb-add-repository-'));
    createRemotes(root);
    await serve();
    database = createTestDatabase();
    unlocks = new KeyUnlockStore({ keyUnlockIdleMs: 3_600_000 } as Config, new SessionLifecycle());
    saved = new SavedCredentialsService(database, box, unlocks);
    const gitOptions = testGitOptions();
    runner = new JobRunner(database, { cloneConcurrency: 2 } as Config, { publish: vi.fn() } as unknown as EventsHub);
    // Not started: the clone job stays queued (the clone itself is covered by its own spec).
    runner.register({
      type: 'repositories.clone',
      pool: 'clone',
      onInterrupted: 'fail',
      handler: () => Promise.resolve()
    });
    cloneKeys = new CloneKeys();
    service = new AddRepositoryService(
      database,
      new RequestCredentials(saved, unlocks),
      saved,
      unlocks,
      new KnownHostsService(database, gitOptions),
      new GitEngine(gitOptions, new GitRunner()),
      runner,
      cloneKeys
    );
    alice = { id: insertUser(database, 'alice@x.io'), sessionId: SESSION };
  });

  afterEach(async () => {
    unlocks.onModuleDestroy();
    await server.close();
    database.sqlite.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('lists branches for the form', async () => {
    expect(await service.accessCheck(alice, { remoteUrl: handbookUrl(), credentials: { mode: 'none' } })).toEqual({
      branches: [ 'draft', 'main' ],
      defaultBranch: 'main'
    });
    expect(await service.accessCheck(alice, { remoteUrl: `${server.url}/empty.git`, credentials: { mode: 'none' } }))
      .toEqual({ branches: [], defaultBranch: null });
  });

  it('reports a missing repository on the URL', async () => {
    const error = await rejectionOf(
      service.accessCheck(alice, { remoteUrl: `${server.url}/missing.git`, credentials: { mode: 'none' } })
    );
    expect(error).toEqual(fieldError('remoteUrl', 'repository-not-found'));
  });

  it('adds a public repository with no credentials', async () => {
    const summary = await service.add(alice, request());

    const { repositories: [ row ], credentials, jobs: [ job ] } = all();
    expect(row).toMatchObject({
      userId: alice.id,
      name: 'Handbook',
      remoteUrl: handbookUrl(),
      credentialId: null,
      cloneMode: 'full',
      branch: null,
      gitLevel: 'advanced',
      status: 'cloning',
      errorCode: null
    });
    expect(row?.lastAccessedAt.getTime()).toBe(row?.createdAt.getTime());
    expect(credentials).toEqual([]);
    expect(job).toMatchObject({
      type: 'repositories.clone',
      userId: alice.id,
      repositoryId: row?.id,
      status: 'queued',
      payload: JSON.stringify({ repositoryId: row?.id }),
      dedupeKey: `clone:${row?.id}`
    });
    expect(summary).toMatchObject({ id: row?.id, name: 'Handbook', status: 'cloning', error: null });
  });

  it('saves new HTTPS credentials with the repository', async () => {
    await serve({ alice: TOKEN });

    await service.add(
      alice,
      request({
        credentials: { mode: 'new-https', name: 'Work', username: 'alice', password: TOKEN }
      })
    );

    const { repositories: [ row ], credentials: [ credential ] } = all();
    expect(credential).toMatchObject({ userId: alice.id, kind: 'https', name: 'Work', username: 'alice' });
    expect(row?.credentialId).toBe(credential?.id);
  });

  it('saves nothing when the access check fails', async () => {
    await serve({ alice: TOKEN });

    const error = await rejectionOf(service.add(
      alice,
      request({
        credentials: { mode: 'new-https', name: 'Work', username: 'alice', password: 'wrong' }
      })
    ));

    expect(error).toEqual(fieldError('credentials', 'credentials-refused', { generatedKey: false }));
    expect(all()).toEqual({ repositories: [], credentials: [], jobs: [] });
  });

  it('asks for credentials for a private repository added without', async () => {
    await serve({ alice: TOKEN });
    expect(await rejectionOf(service.add(alice, request()))).toEqual(fieldError('credentials', 'credentials-required'));
  });

  it('defaults to the highest allowed level', async () => {
    database.db.update(users).set({ allowedGitLevels: [ 'guided', 'simple' ] }).where(eq(users.id, alice.id)).run();
    await service.add(alice, request());
    expect(all().repositories[0]?.gitLevel).toBe('guided');
  });

  it('refuses a level the user is not allowed', async () => {
    expect(await rejectionOf(service.add(alice, request({ gitLevel: 'simple' })))).toEqual(
      fieldError('gitLevel', 'level-not-allowed')
    );
    expect(all().repositories).toEqual([]);
  });

  it('refuses a taken name in any case', async () => {
    insertRepository(database, alice.id, { name: 'handbook' });
    expect(await rejectionOf(service.add(alice, request({ name: 'HANDBOOK' })))).toEqual(
      fieldError('name', 'name-taken', { name: 'HANDBOOK' })
    );
  });

  it('accepts a remote the user already has under a new name', async () => {
    insertRepository(database, alice.id, { name: 'Handbook', remoteUrl: handbookUrl() });
    await service.add(alice, request({ name: 'Handbook 2' }));
    expect(all().repositories.map(row => row.name)).toEqual([ 'Handbook', 'Handbook 2' ]);
  });

  it('creates one repository for two quick submits', async () => {
    await serve({ alice: TOKEN });
    const submit = () =>
      service.add(
        alice,
        request({ credentials: { mode: 'new-https', name: 'Work', username: 'alice', password: TOKEN } })
      );

    const results = await Promise.allSettled([ submit(), submit() ]);

    expect(results.map(result => result.status).sort()).toEqual([ 'fulfilled', 'rejected' ]);
    const rejected = results.find(result => result.status === 'rejected');
    expect(rejected?.reason).toEqual(fieldError('name', 'name-taken', { name: 'Handbook' }));
    expect(all().repositories).toHaveLength(1);
    expect(all().credentials).toHaveLength(1);
    expect(all().jobs).toHaveLength(1);
  });

  it('checks that the single branch exists', async () => {
    expect(await rejectionOf(service.add(alice, request({ cloneMode: 'single-branch', branch: 'gone' })))).toEqual(
      fieldError('branch', 'branch-not-found')
    );

    await service.add(alice, request({ cloneMode: 'single-branch', branch: 'draft' }));

    expect(all().repositories[0]).toMatchObject({ cloneMode: 'single-branch', branch: 'draft' });
  });

  it('ignores the branch of a full clone', async () => {
    await service.add(alice, request({ branch: 'draft' }));
    expect(all().repositories[0]?.branch).toBeNull();
  });

  it('refuses a single-branch clone of an empty remote', async () => {
    const error = await rejectionOf(service.add(
      alice,
      request({
        remoteUrl: `${server.url}/empty.git`,
        cloneMode: 'single-branch',
        branch: 'main'
      })
    ));
    expect(error).toEqual(fieldError('branch', 'no-branches'));
  });

  it('adds an empty remote as a full clone', async () => {
    await service.add(alice, request({ remoteUrl: `${server.url}/empty.git` }));
    expect(all().repositories).toHaveLength(1);
  });

  it('refuses a taken credentials name before contacting the remote', async () => {
    database.db.transaction(tx => saved.createHttps(tx, alice.id, { name: 'work', username: 'a', password: 'p' }));
    await server.close();

    const error = await rejectionOf(service.add(
      alice,
      request({
        credentials: { mode: 'new-https', name: 'Work', username: 'alice', password: TOKEN }
      })
    ));

    expect(error).toEqual(fieldError('credentials.name', 'name-taken'));
  });

  describe('with a passphrase-protected key', () => {
    // The HTTPS test server cannot check keys, so the access check is stubbed here;
    // cloning over SSH with a held key is covered by the clone job's spec.
    beforeEach(() => {
      vi.spyOn(GitEngine.prototype, 'accessCheck').mockResolvedValue({ branches: [ 'main' ], defaultBranch: 'main' });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('holds the unlocked key for the clone job', async () => {
      const id = database.db.transaction(tx =>
        saved.createPastedKey(tx, alice.id, {
          name: 'Laptop',
          privateKey: sshKeyFixture('ed25519-passphrase'),
          passphrase: FIXTURE_PASSPHRASE
        })
      );

      await service.add(
        alice,
        request({
          remoteUrl: 'git@git.example.com:acme/handbook.git',
          credentials: { mode: 'saved', credentialId: id, passphrase: FIXTURE_PASSPHRASE }
        })
      );

      const [ job ] = all().jobs;
      expect(cloneKeys.take(job?.id ?? 0)).toBeInstanceOf(UnlockedKey);
      expect(all().repositories[0]?.credentialId).toBe(id);
    });

    it('saves a pasted key and unlocks it for the session', async () => {
      await service.add(
        alice,
        request({
          remoteUrl: 'git@git.example.com:acme/handbook.git',
          credentials: {
            mode: 'new-ssh-key',
            name: 'Laptop',
            privateKey: sshKeyFixture('ed25519-passphrase'),
            passphrase: FIXTURE_PASSPHRASE
          }
        })
      );

      const { credentials: [ credential ], jobs: [ job ] } = all();
      expect(credential).toMatchObject({ kind: 'ssh-key', name: 'Laptop', sshPassphraseProtected: true });
      expect(unlocks.isUnlocked(SESSION, credential?.id ?? 0)).toBe(true);
      expect(cloneKeys.take(job?.id ?? 0)).toBeInstanceOf(UnlockedKey);
    });
  });
});
