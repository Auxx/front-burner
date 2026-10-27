import type { Config } from '@front-burner/server-core-config';
import { SecretBox } from '@front-burner/server-core-crypto';
import { Database, jobs, repositories } from '@front-burner/server-core-database';
import type { EventsHub } from '@front-burner/server-core-events';
import { GitEngine, GitOptions, GitRunner } from '@front-burner/server-core-git';
import {
  FIXTURE_PASSPHRASE,
  GitHttpServer,
  GitSshServer,
  sshKeyFixture,
  startGitHttpServer,
  startGitSshServer
} from '@front-burner/server-core-git/testing';
import { JobRunner } from '@front-burner/server-core-jobs';
import { SessionLifecycle } from '@front-burner/server-core-security';
import { DataLayout } from '@front-burner/server-core-storage';
import { KeyUnlockStore, KnownHostsService, SavedCredentialsService } from '@front-burner/server-feature-credentials';
import type { AddRepositoryRequest, PushEvent } from '@front-burner/shared-contracts';
import { eq } from 'drizzle-orm';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddRepositoryService } from '../add/add-repository.service';
import { RequestCredentials } from '../add/request-credentials';
import { insertUser } from '../testing/fixtures';
import { createRemotes, git, testGitOptions, trustTestCertificate } from '../testing/git-fixtures';
import { createTestDatabase } from '../testing/test-database';
import { CloneKeys } from './clone-keys';
import { CloneJob } from './clone.job';

const box = new SecretBox('clone-job-spec-key-0123456789abcdef');
const SESSION = 'session-1';

/** Polls until `check` holds, for at most 20 seconds. */
async function waitFor(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error('timed out waiting');
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

describe('CloneJob', () => {
  let restoreCa: () => void;
  let root: string;
  let remotes: { handbook: string; empty: string; };
  let server: GitHttpServer;
  let database: Database;
  let layout: DataLayout;
  let lifecycle: SessionLifecycle;
  let unlocks: KeyUnlockStore;
  let saved: SavedCredentialsService;
  let runner: JobRunner;
  let engine: GitEngine;
  let publish: ReturnType<typeof vi.fn<(userId: number, event: PushEvent) => void>>;
  let adding: AddRepositoryService;
  let alice: { id: number; sessionId: string; };

  function build(gitOptions: GitOptions = testGitOptions()): void {
    publish = vi.fn();
    const events = { publish } as unknown as EventsHub;
    runner = new JobRunner(database, { cloneConcurrency: 2 } as Config, events);
    engine = new GitEngine(gitOptions, new GitRunner());
    const knownHosts = new KnownHostsService(database, gitOptions);
    const cloneKeys = new CloneKeys();
    new CloneJob(database, runner, engine, saved, knownHosts, cloneKeys, events, layout).onModuleInit();
    adding = new AddRepositoryService(
      database,
      new RequestCredentials(saved, unlocks),
      saved,
      unlocks,
      knownHosts,
      engine,
      runner,
      cloneKeys
    );
  }

  const add = (overrides: Partial<AddRepositoryRequest> = {}) =>
    adding.add(alice, {
      remoteUrl: `${server.url}/handbook.git`,
      name: 'Handbook',
      credentials: { mode: 'none' },
      cloneMode: 'full',
      ...overrides
    });
  const rowOf = (id: number) => database.db.select().from(repositories).where(eq(repositories.id, id)).get();
  const settled = (id: number) => waitFor(() => rowOf(id)?.status !== 'cloning');

  beforeAll(() => {
    restoreCa = trustTestCertificate();
  });

  afterAll(() => {
    restoreCa();
  });

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'fb-clone-job-'));
    remotes = createRemotes(root);
    server = await startGitHttpServer({ repositories: { 'handbook.git': remotes.handbook } });
    layout = new DataLayout(join(root, 'data'));
    mkdirSync(layout.tmpDir, { recursive: true });
    mkdirSync(layout.reposDir, { recursive: true });
    database = createTestDatabase();
    lifecycle = new SessionLifecycle();
    unlocks = new KeyUnlockStore({ keyUnlockIdleMs: 3_600_000 } as Config, lifecycle);
    saved = new SavedCredentialsService(database, box, unlocks);
    alice = { id: insertUser(database, 'alice@x.io'), sessionId: SESSION };
    build();
  });

  afterEach(async () => {
    await runner.beforeApplicationShutdown();
    await engine.beforeApplicationShutdown();
    unlocks.onModuleDestroy();
    await server.close();
    database.sqlite.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('clones and becomes ready', async () => {
    const bob = insertUser(database, 'bob@x.io');
    const { id } = await add();

    runner.start();
    await settled(id);

    expect(rowOf(id)).toMatchObject({ status: 'ready', errorCode: null });
    const workingCopy = layout.workingCopy(alice.id, id);
    expect(git(workingCopy, 'branch', '--show-current').trim()).toBe('main');
    expect(readdirSync(layout.tmpDir)).toEqual([]);
    expect(publish).toHaveBeenCalledWith(alice.id, {
      type: 'repository.status',
      repositoryId: id,
      status: 'ready',
      error: null
    });
    expect(publish.mock.calls.filter(([ userId ]) => userId === bob)).toEqual([]);
  });

  it('clones only the chosen branch of a single-branch clone', async () => {
    const { id } = await add({ cloneMode: 'single-branch', branch: 'draft' });

    runner.start();
    await settled(id);

    const workingCopy = layout.workingCopy(alice.id, id);
    expect(git(workingCopy, 'branch', '--show-current').trim()).toBe('draft');
    expect(git(workingCopy, 'branch', '-r').trim()).toBe('origin/draft');
  });

  it('fails with Clone failed when the remote disappears', async () => {
    const { id } = await add();
    rmSync(remotes.handbook, { recursive: true, force: true });

    runner.start();
    await settled(id);

    expect(rowOf(id)).toMatchObject({ status: 'error', errorCode: 'clone-failed' });
    expect(existsSync(layout.workingCopy(alice.id, id))).toBe(false);
    expect(readdirSync(layout.tmpDir)).toEqual([]);
    expect(publish).toHaveBeenCalledWith(alice.id, {
      type: 'repository.status',
      repositoryId: id,
      status: 'error',
      error: 'clone-failed'
    });
  });

  it('fails with Clone timed out', async () => {
    const { id } = await add();
    await server.close();
    server = await startGitHttpServer({ repositories: { 'handbook.git': remotes.handbook }, delayMs: 2_000 });
    await runner.beforeApplicationShutdown();
    // The stored URL names the first server's port; this one answers on its own.
    database.db.update(repositories).set({ remoteUrl: `${server.url}/handbook.git` }).run();
    build(testGitOptions({ cloneTimeoutMs: 300 }));

    runner.start();
    await settled(id);

    expect(rowOf(id)).toMatchObject({ status: 'error', errorCode: 'clone-timed-out' });
    expect(existsSync(layout.workingCopy(alice.id, id))).toBe(false);
  });

  it('fails an interrupted clone on start', async () => {
    const { id } = await add();
    database.db.update(jobs).set({ status: 'running', attempts: 1 }).where(eq(jobs.type, 'repositories.clone')).run();

    runner.start();

    expect(rowOf(id)).toMatchObject({ status: 'error', errorCode: 'clone-failed' });
    expect(publish).toHaveBeenCalledWith(alice.id, {
      type: 'repository.status',
      repositoryId: id,
      status: 'error',
      error: 'clone-failed'
    });
  });

  describe('over SSH', () => {
    let ssh: GitSshServer;

    beforeEach(async () => {
      ssh = await startGitSshServer({
        repositories: { 'handbook.git': remotes.handbook },
        authorizedKeys: [ sshKeyFixture('ed25519-passphrase.pub') ]
      });
      await runner.beforeApplicationShutdown();
      build(testGitOptions({ knownHosts: [ ssh.hostKeyLine ] }));
    });

    afterEach(async () => {
      await ssh.close();
    });

    it('clones with a protected key after the session ended', async () => {
      const keyId = database.db.transaction(tx =>
        saved.createPastedKey(tx, alice.id, {
          name: 'Laptop',
          privateKey: sshKeyFixture('ed25519-passphrase'),
          passphrase: FIXTURE_PASSPHRASE
        })
      );
      const { id } = await add({
        remoteUrl: `ssh://git@${ssh.host}:${ssh.port}/handbook.git`,
        credentials: { mode: 'saved', credentialId: keyId, passphrase: FIXTURE_PASSPHRASE }
      });

      lifecycle.notifyRevoked(SESSION);
      expect(unlocks.isUnlocked(SESSION, keyId)).toBe(false);
      runner.start();
      await settled(id);

      expect(rowOf(id)).toMatchObject({ status: 'ready', errorCode: null });
    });
  });
});
