import type { Config } from '@front-burner/server-core-config';
import { SecretBox } from '@front-burner/server-core-crypto';
import { Database } from '@front-burner/server-core-database';
import { EventsHub } from '@front-burner/server-core-events';
import { FIXTURE_PASSPHRASE, sshKeyFixture } from '@front-burner/server-core-git/testing';
import { SessionLifecycle } from '@front-burner/server-core-security';
import { KeyUnlockStore, SavedCredentialsService, UnlockAttempts } from '@front-burner/server-feature-credentials';
import { RepositoryQueries } from '../repositories/repository-queries';
import { insertRepository, insertUser } from '../testing/fixtures';
import { createTestDatabase } from '../testing/test-database';
import { RepositoryCredentialsService } from './repository-credentials.service';

const IDLE = 60 * 60_000;
const box = new SecretBox('repository-credentials-spec-key-0123456789');
const SSH_REMOTE = 'git@github.com:acme/handbook.git';

describe('RepositoryCredentialsService', () => {
  let database: Database;
  let unlocks: KeyUnlockStore;
  let saved: SavedCredentialsService;
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
  const createHttps = (userId = alice) =>
    database.db.transaction(tx =>
      saved.createHttps(tx, userId, { name: 'Work', username: 'alice', password: 'ghp_secret-token' })
    );

  beforeEach(() => {
    vi.useFakeTimers({ toFake: [ 'setTimeout', 'clearTimeout' ] });
    database = createTestDatabase();
    unlocks = new KeyUnlockStore({ keyUnlockIdleMs: IDLE } as Config, new SessionLifecycle(), new EventsHub());
    saved = new SavedCredentialsService(database, box, unlocks, new UnlockAttempts());
    service = new RepositoryCredentialsService(database, new RepositoryQueries(database), saved, unlocks);
    alice = insertUser(database, 'alice@x.io');
    bob = insertUser(database, 'bob@x.io');
  });

  afterEach(() => {
    unlocks.onModuleDestroy();
    database.sqlite.close();
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
      inUse: { kind: 'https', id: https, name: 'Work', username: 'alice', usedBy: 2 }
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
    const key = createKey();
    const id = insertRepository(database, alice, { name: 'handbook', remoteUrl: SSH_REMOTE, credentialId: key });
    saved.unlock(alice, 's1', key, FIXTURE_PASSPHRASE);

    vi.advanceTimersByTime(IDLE - 1000);
    expect(service.get(alice, 's1', id).inUse).toMatchObject({ unlocked: true });
    vi.advanceTimersByTime(1000);

    expect(service.get(alice, 's1', id).inUse).toMatchObject({ unlocked: false });
  });

  it('answers another user\'s repository like a missing one', () => {
    const id = insertRepository(database, bob, { name: 'handbook', credentialId: createHttps(bob) });

    expect(() => service.get(alice, 's1', id)).toThrow(expect.objectContaining({ code: 'not-found' }));
    expect(() => service.get(alice, 's1', 9999)).toThrow(expect.objectContaining({ code: 'not-found' }));
  });
});
