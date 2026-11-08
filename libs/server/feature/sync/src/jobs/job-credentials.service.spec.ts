import { repositories } from '@front-burner/server-core-database';
import { unlockPrivateKey } from '@front-burner/server-core-git';
import { FIXTURE_PASSPHRASE, sshKeyFixture } from '@front-burner/server-core-git/testing';
import { eq } from 'drizzle-orm';
import { PushHarness } from '../testing/push-harness';

describe.skipIf(process.platform === 'win32')('JobCredentials', () => {
  let harness: PushHarness;

  const setCredential = (credentialId: number | null) => {
    harness.database.db.update(repositories).set({ credentialId })
      .where(eq(repositories.id, harness.repositoryId)).run();
  };
  const resolve = (jobId = 1) => {
    const row = harness.database.db.select().from(repositories).where(eq(repositories.id, harness.repositoryId)).get()!;
    return harness.jobCredentials.resolve(jobId, harness.alice, row);
  };
  const protectedKey = () =>
    harness.database.db.transaction(tx =>
      harness.saved.createPastedKey(tx, harness.alice, {
        name: 'Laptop',
        privateKey: sshKeyFixture('ed25519-passphrase'),
        passphrase: FIXTURE_PASSPHRASE
      })
    );

  beforeEach(async () => {
    harness = await PushHarness.start();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('has none for a repository without a credential', () => {
    setCredential(null);

    expect(resolve()).toEqual({ credentials: { kind: 'none' } });
  });

  it('resolves the user\'s HTTPS credentials', () => {
    const id = harness.database.db.transaction(tx =>
      harness.saved.createHttps(tx, harness.alice, { name: 'Mine', username: 'alice', password: 'secret' })
    );
    setCredential(id);

    expect(resolve()).toMatchObject({ credentials: { kind: 'https', username: 'alice' } });
  });

  it('reports credentials-missing for a credential that is not the user\'s', () => {
    const theirs = harness.database.db.transaction(tx =>
      harness.saved.createHttps(tx, harness.bob, { name: 'Bob', username: 'bob', password: 'secret' })
    );
    setCredential(theirs);

    expect(resolve()).toEqual({ failure: { kind: 'failed', code: 'credentials-missing', params: {} } });
  });

  it('reports key-locked for a protected key without the copy held for the job', () => {
    const keyId = protectedKey();
    setCredential(keyId);

    expect(resolve()).toEqual({
      failure: { kind: 'failed', code: 'key-locked', params: { keyId: String(keyId), keyName: 'Laptop' } }
    });
  });

  it('uses the copy of a protected key held for the job', () => {
    const keyId = protectedKey();
    setCredential(keyId);
    harness.jobKeys.hold(7, keyId, unlockPrivateKey(sshKeyFixture('ed25519-passphrase'), FIXTURE_PASSPHRASE));

    expect(resolve(7)).toMatchObject({ credentials: { kind: 'ssh' } });
  });
});
