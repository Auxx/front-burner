import { jobs, savedCredentials } from '@front-burner/server-core-database';
import type { UnlockedKey } from '@front-burner/server-core-git';
import { FIXTURE_PASSPHRASE, sshKeyFixture } from '@front-burner/server-core-git/testing';
import { eq } from 'drizzle-orm';
import { PushHarness } from '../testing/push-harness';

const SESSION = 'session-1';
const TEST_TYPE = 'test.network';

// The harness's broker listens on a Unix socket in a POSIX path: not on Windows.
describe.skipIf(process.platform === 'win32')('NetworkJobs', () => {
  let harness: PushHarness;
  let keyId: number;
  /** What each test job found held for it when it ran. */
  let heldWhenRun: (UnlockedKey | undefined)[];

  const auth = () => ({ userId: harness.alice, sessionId: SESSION });
  const row = (credentialId: number | null) => ({ id: harness.repositoryId, credentialId });
  const queue = (credentialId: number | null, dedupeKey = 'test:1') =>
    harness.networkJobs.queue(auth(), row(credentialId), { type: TEST_TYPE, payload: { n: 1 }, dedupeKey });
  const testJobs = () => harness.database.db.select().from(jobs).where(eq(jobs.type, TEST_TYPE)).all();
  const gitChanged = () => harness.published.filter(({ event }) => event.type === 'git.changed');

  beforeEach(async () => {
    harness = await PushHarness.start();
    heldWhenRun = [];
    harness.runner.register({
      type: TEST_TYPE,
      pool: 'fetch',
      onInterrupted: 'fail',
      handler: async job => {
        heldWhenRun.push(harness.jobKeys.take(job.id, keyId));
        return null;
      }
    });
    keyId = harness.database.db.transaction(tx =>
      harness.saved.createPastedKey(tx, harness.alice, {
        name: 'Laptop',
        privateKey: sshKeyFixture('ed25519-passphrase'),
        passphrase: FIXTURE_PASSPHRASE
      })
    );
  });

  afterEach(async () => {
    await harness.close();
  });

  it('queues one job per dedupe key, and publishes git.changed', () => {
    const first = queue(null);
    const second = queue(null);

    expect(second).toBe(first);
    expect(testJobs()).toEqual([
      expect.objectContaining({
        id: first,
        userId: harness.alice,
        repositoryId: harness.repositoryId,
        payload: JSON.stringify({ n: 1 }),
        dedupeKey: 'test:1'
      })
    ]);
    expect(gitChanged()).toEqual([
      { userId: harness.alice, event: { type: 'git.changed', repositoryId: harness.repositoryId } },
      { userId: harness.alice, event: { type: 'git.changed', repositoryId: harness.repositoryId } }
    ]);
  });

  it('holds the key copy before the runner can start the job', async () => {
    harness.saved.unlock(harness.alice, SESSION, keyId, FIXTURE_PASSPHRASE);
    // The runner's loop is running, so it takes the job up as soon as it can.
    harness.runner.start();

    const id = queue(keyId);
    await harness.finished(id);

    expect(heldWhenRun).toEqual([ expect.anything() ]);
  });

  it('refuses a locked key and missing credentials before queueing', () => {
    expect(() => queue(keyId)).toThrow(expect.objectContaining({ code: 'key-locked' }));

    harness.database.db.update(savedCredentials).set({ secret: null }).where(eq(savedCredentials.id, keyId)).run();
    expect(() => queue(keyId)).toThrow(expect.objectContaining({ code: 'credentials-missing' }));

    expect(testJobs()).toEqual([]);
    expect(gitChanged()).toEqual([]);
  });
});
