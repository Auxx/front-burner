import { repositories, syncState } from '@front-burner/server-core-database';
import { GitEngine, GitOperationError } from '@front-burner/server-core-git';
import {
  FIXTURE_PASSPHRASE,
  GitSshServer,
  sshKeyFixture,
  startGitSshServer
} from '@front-burner/server-core-git/testing';
import { KnownHostsService } from '@front-burner/server-feature-credentials';
import { eq } from 'drizzle-orm';
import { git, testGitOptions, trustTestCertificate } from '../testing/git-fixtures';
import { PushHarness } from '../testing/push-harness';
import { FetchStep } from './fetch-step';

const TOKEN = 'ghp_fetch-step-secret-token';

// The broker listens on a Unix socket in a POSIX path: not on Windows.
describe.skipIf(process.platform === 'win32')('FetchStep', () => {
  let restoreCa: () => void;
  let harness: PushHarness;
  let nextJob = 1000;

  const run = (repositoryId = harness.repositoryId) =>
    harness.fetchStep.run({ id: nextJob++, userId: harness.alice, repositoryId });
  const stored = (repositoryId = harness.repositoryId) =>
    harness.database.db.select().from(syncState).where(eq(syncState.repositoryId, repositoryId)).get();
  const gitChanged = () =>
    harness.published.filter(({ event }) =>
      event.type === 'git.changed' && event.repositoryId === harness.repositoryId
    );

  /** Gives the repository saved HTTPS credentials whose password is `password`. */
  function useHttpsCredentials(password: string): void {
    const credentialId = harness.database.db.transaction(tx =>
      harness.saved.createHttps(tx, harness.alice, { name: 'Token', username: 'alice', password })
    );
    harness.database.db.update(repositories).set({ credentialId }).where(eq(repositories.id, harness.repositoryId))
      .run();
  }

  beforeAll(() => {
    restoreCa = trustTestCertificate();
  });

  afterAll(() => {
    restoreCa();
  });

  beforeEach(async () => {
    harness = await PushHarness.start();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('reports refused credentials and an unreachable host by their codes', async () => {
    await harness.serve({ users: { alice: 'the-right-token' } });
    useHttpsCredentials('a-wrong-token');

    expect(await run()).toEqual({
      ok: false,
      failure: { kind: 'failed', code: 'credentials-refused', params: { host: '127.0.0.1' } }
    });

    harness.useRemote('https://127.0.0.1:1/handbook.git');
    expect(await run()).toEqual({
      ok: false,
      failure: { kind: 'failed', code: 'host-unreachable', params: { host: '127.0.0.1' } }
    });
    expect(harness.syncState.fetchProblem(harness.repositoryId)).toEqual({
      code: 'host-unreachable',
      params: { host: '127.0.0.1' }
    });
  });

  it('keeps only the last fetch\'s problem', async () => {
    expect(harness.syncState.fetchProblem(harness.repositoryId)).toBeNull();
    await harness.serve({ users: { alice: TOKEN } });
    expect(await run()).toMatchObject({ ok: false, failure: { code: 'no-credentials' } });
    expect(harness.syncState.fetchProblem(harness.repositoryId)).toEqual({
      code: 'no-credentials',
      params: { host: '127.0.0.1' }
    });

    await harness.serve({});
    expect(await run()).toEqual({ ok: true, moved: false, upstreamMoved: false });
    expect(harness.syncState.fetchProblem(harness.repositoryId)).toBeNull();

    harness.useRemote('https://127.0.0.1:1/handbook.git');
    await run();
    await harness.serve({ users: { alice: TOKEN } });
    await run();
    expect(harness.syncState.fetchProblem(harness.repositoryId)).toEqual({
      code: 'no-credentials',
      params: { host: '127.0.0.1' }
    });
  });

  it('stores no secret', async () => {
    // The credentials the remote refuses carry the token.
    await harness.serve({ users: { alice: 'the-right-token' } });
    useHttpsCredentials(TOKEN);
    await run();
    expect(stored()?.fetchProblem).toBe(JSON.stringify({ code: 'credentials-refused', params: { host: '127.0.0.1' } }));

    // git's own lines, where a token could be, are never stored: only the code and params.
    const engine = {
      fetch: () =>
        Promise.reject(
          new GitOperationError('auth-failed', `fatal: Authentication failed for 'https://alice:${TOKEN}@x/'`, {
            host: 'x'
          })
        )
    } as unknown as GitEngine;
    const step = new FetchStep(
      engine,
      harness.networkLock,
      harness.openable,
      harness.jobCredentials,
      new KnownHostsService(harness.database, testGitOptions()),
      harness.syncState,
      harness.events
    );
    await step.run({ id: nextJob++, userId: harness.alice, repositoryId: harness.repositoryId });
    expect(stored()?.fetchProblem).toBe(JSON.stringify({ code: 'credentials-refused', params: { host: 'x' } }));
    expect(JSON.stringify(stored())).not.toContain(TOKEN);
  });

  describe('over SSH', () => {
    let ssh: GitSshServer;

    beforeEach(async () => {
      ssh = await startGitSshServer({ repositories: { 'handbook.git': harness.bare }, authorizedKeys: [] });
    });

    afterEach(async () => {
      await ssh.close();
    });

    it('stores an unknown host key\'s public params only', async () => {
      harness.useRemote(`ssh://git@${ssh.host}:${ssh.port}/handbook.git`);

      await run();

      const problem = harness.syncState.fetchProblem(harness.repositoryId);
      expect(problem).toEqual({
        code: 'host-key-unknown',
        params: {
          host: '127.0.0.1',
          port: String(ssh.port),
          type: expect.any(String),
          key: expect.any(String),
          fingerprint: expect.stringMatching(/^SHA256:/)
        }
      });
      // The key is the server's public host key.
      expect(ssh.hostKeyLine.endsWith(`${problem?.params['type']} ${problem?.params['key']}`)).toBe(true);
    });
  });

  it('does not store a locked key', async () => {
    const keyId = harness.database.db.transaction(tx =>
      harness.saved.createPastedKey(tx, harness.alice, {
        name: 'Laptop',
        privateKey: sshKeyFixture('ed25519-passphrase'),
        passphrase: FIXTURE_PASSPHRASE
      })
    );
    harness.useRemote('https://127.0.0.1:1/handbook.git');
    await run();
    harness.database.db.update(repositories).set({ credentialId: keyId })
      .where(eq(repositories.id, harness.repositoryId)).run();
    const before = gitChanged().length;

    // No copy of the key is held for the job.
    expect(await run()).toEqual({
      ok: false,
      failure: { kind: 'failed', code: 'key-locked', params: { keyId: String(keyId), keyName: 'Laptop' } }
    });

    expect(harness.syncState.fetchProblem(harness.repositoryId)).toEqual({
      code: 'host-unreachable',
      params: { host: '127.0.0.1' }
    });
    expect(gitChanged()).toHaveLength(before);
  });

  it('publishes git.changed only when something changed', async () => {
    expect(await run()).toEqual({ ok: true, moved: false, upstreamMoved: false });
    expect(gitChanged()).toHaveLength(0);

    harness.pushFromElsewhere('theirs');
    expect(await run()).toEqual({ ok: true, moved: true, upstreamMoved: true });
    expect(gitChanged()).toHaveLength(1);
    expect(git(harness.workingCopy, 'log', '-1', '--format=%s', 'origin/main').trim()).toBe('theirs');

    await run();
    expect(gitChanged()).toHaveLength(1);

    harness.useRemote('https://127.0.0.1:1/handbook.git');
    await run();
    expect(gitChanged()).toHaveLength(2);
    await run();
    expect(gitChanged()).toHaveLength(2);
    expect(gitChanged().every(({ userId }) => userId === harness.alice)).toBe(true);
  });
});
