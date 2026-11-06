import type { Config } from '@front-burner/server-core-config';
import { SecretBox } from '@front-burner/server-core-crypto';
import { Database, savedCredentials } from '@front-burner/server-core-database';
import { EventsHub } from '@front-burner/server-core-events';
import { SSH_KEY_PROBLEMS, UnlockedKey } from '@front-burner/server-core-git';
import { FIXTURE_PASSPHRASE, sshKeyFixture } from '@front-burner/server-core-git/testing';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { SessionLifecycle } from '@front-burner/server-core-security';
import { CREDENTIALS_FIELD_CODES } from '@front-burner/shared-contracts';
import { NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { insertUser } from '../testing/fixtures';
import { createTestDatabase } from '../testing/test-database';
import { KeyUnlockStore } from '../unlocks/key-unlock-store';
import { UnlockAttempts } from '../unlocks/unlock-attempts';
import { SavedCredentialsService } from './saved-credentials.service';

const box = new SecretBox('saved-credentials-spec-key-0123456789abcdef');
const work = { name: 'Work', username: 'alice', password: 'ghp_secret-token' };
const PROTECTED = sshKeyFixture('ed25519-passphrase');
const PLAIN = sshKeyFixture('ed25519');

const fieldError = (path: string, code: string) =>
  expect.objectContaining({ code: 'validation-failed', fields: [ { path, code, params: {} } ] });

describe('SavedCredentialsService', () => {
  let database: Database;
  let unlocks: KeyUnlockStore;
  let attempts: UnlockAttempts;
  let service: SavedCredentialsService;
  let alice: number;
  let bob: number;

  const row = (id: number) => database.db.select().from(savedCredentials).where(eq(savedCredentials.id, id)).get();
  const createHttps = (userId = alice, input = work) =>
    database.db.transaction(tx => service.createHttps(tx, userId, input));
  const createKey = (privateKey: string, passphrase?: string, name = 'Laptop') =>
    database.db.transaction(tx => service.createPastedKey(tx, alice, { name, privateKey, passphrase }));

  beforeEach(() => {
    database = createTestDatabase();
    unlocks = new KeyUnlockStore({ keyUnlockIdleMs: 3_600_000 } as Config, new SessionLifecycle(), new EventsHub());
    attempts = new UnlockAttempts();
    service = new SavedCredentialsService(database, box, unlocks, attempts);
    alice = insertUser(database, 'alice@x.io');
    bob = insertUser(database, 'bob@x.io');
  });

  afterEach(() => {
    unlocks.onModuleDestroy();
    database.sqlite.close();
  });

  it('lists the same field codes as the git engine', () => {
    expect(CREDENTIALS_FIELD_CODES.filter(code => code !== 'name-taken')).toEqual([ ...SSH_KEY_PROBLEMS ]);
  });

  it('stores HTTPS credentials encrypted', () => {
    const id = createHttps();

    const stored = row(id);
    expect(stored).toMatchObject({ userId: alice, kind: 'https', name: 'Work', username: 'alice' });
    expect(stored?.secret).not.toContain(work.password);
    expect(box.decrypt(stored?.secret ?? '', { table: 'saved_credentials', recordId: id, userId: alice }))
      .toBe(work.password);
  });

  it('refuses a taken name', () => {
    createHttps();
    expect(() => createHttps(alice, { ...work, name: 'WORK' })).toThrow(fieldError('name', 'name-taken'));
    createHttps(bob);
    expect(database.db.select().from(savedCredentials).all()).toHaveLength(2);
  });

  it('stores a pasted key with its public parts', () => {
    const id = createKey(PROTECTED, FIXTURE_PASSPHRASE);

    const stored = row(id);
    expect(stored).toMatchObject({
      kind: 'ssh-key',
      name: 'Laptop',
      username: null,
      sshKeyType: 'ed25519',
      sshPublicKey: sshKeyFixture('ed25519-passphrase.pub').trim().split(' ').slice(0, 2).join(' '),
      sshFingerprint: expect.stringMatching(/^SHA256:/),
      sshPassphraseProtected: true,
      sshGenerated: false
    });
    // The text as pasted, still encrypted with its passphrase (AR-28).
    expect(box.decrypt(stored?.secret ?? '', { table: 'saved_credentials', recordId: id, userId: alice }))
      .toBe(PROTECTED);
  });

  it('refuses a DSA key on privateKey', () => {
    expect(() => createKey(sshKeyFixture('dsa'))).toThrow(fieldError('privateKey', 'unsupported-type'));
  });

  it('refuses a wrong passphrase on passphrase', () => {
    expect(() => createKey(PROTECTED, 'wrong')).toThrow(fieldError('passphrase', 'wrong-passphrase'));
  });

  it('saves a generated key at once', () => {
    const generated = service.generateKey(alice, 'Generated', 'front-burner@fb.example.com');

    expect(generated.publicKey).toMatch(/^ssh-ed25519 \S+ front-burner@fb\.example\.com$/);
    expect(generated.key).toEqual({
      id: expect.any(Number),
      name: 'Generated',
      keyType: 'ed25519',
      fingerprint: expect.stringMatching(/^SHA256:/),
      passphraseProtected: false,
      unlocked: false,
      generated: true,
      missing: false
    });
    expect(row(generated.key.id)).toMatchObject({ sshGenerated: true, sshPassphraseProtected: false });
  });

  it('refuses a taken name for a generated key', () => {
    createKey(PLAIN, undefined, 'Laptop');
    expect(() => service.generateKey(alice, 'laptop', 'c')).toThrow(fieldError('name', 'name-taken'));
  });

  it('resolves HTTPS credentials for git', () => {
    const id = createHttps();
    expect(service.resolveForGit(alice, 's1', id, { touch: true })).toEqual({
      kind: 'https',
      username: 'alice',
      password: work.password
    });
  });

  describe('replacing HTTPS credentials (RC-13)', () => {
    const replace = (userId: number, id: number, input = { username: 'alice2', password: 'ghp_new-token' }) =>
      database.db.transaction(tx => service.replaceHttps(tx, userId, id, input));

    it('replaces the username and password, encrypted with the row\'s binding, keeping the name', () => {
      const id = createHttps();

      replace(alice, id);

      const stored = row(id);
      expect(stored).toMatchObject({ id, name: 'Work', username: 'alice2' });
      expect(stored?.secret).not.toContain('ghp_new-token');
      expect(box.decrypt(stored?.secret ?? '', { table: 'saved_credentials', recordId: id, userId: alice }))
        .toBe('ghp_new-token');
      expect(service.resolveForJob(alice, id, undefined)).toEqual({
        kind: 'https',
        username: 'alice2',
        password: 'ghp_new-token'
      });
    });

    it('restores a password an encryption key reset deleted', () => {
      const id = createHttps();
      database.db.update(savedCredentials).set({ secret: null }).run();

      replace(alice, id);

      expect(service.list(alice, 's1').https[0]?.missing).toBe(false);
    });

    it('refuses an SSH key', () => {
      const key = createKey(PLAIN);
      const before = row(key);

      expect(() => replace(alice, key)).toThrow(expect.objectContaining({ code: 'credentials-not-updatable' }));
      expect(row(key)).toEqual(before);
    });

    it('answers 404 for another user\'s credentials, and changes nothing', () => {
      const id = createHttps(bob);
      const before = row(id);

      expect(() => replace(alice, id)).toThrow(NotFoundException);
      expect(() => replace(alice, 9999)).toThrow(NotFoundException);
      expect(row(id)).toEqual(before);
    });
  });

  it('resolves an unprotected key without an unlock', () => {
    const id = createKey(PLAIN);
    const credentials = service.resolveForGit(alice, 's1', id, { touch: true });
    expect(credentials).toEqual({ kind: 'ssh', key: expect.any(UnlockedKey) });
  });

  it('asks for the passphrase of a locked key', () => {
    const id = createKey(PROTECTED, FIXTURE_PASSPHRASE);

    const error = (() => {
      try {
        service.resolveForGit(alice, 's1', id, { touch: true });
      } catch (thrown) {
        return thrown;
      }
      return undefined;
    })();
    expect(error).toBeInstanceOf(ApiErrorException);
    expect(error).toMatchObject({ code: 'key-locked', params: { keyId: id, keyName: 'Laptop' } });
    expect((error as ApiErrorException).getStatus()).toBe(409);
  });

  it('resolves a key unlocked in the session', () => {
    const id = createKey(PROTECTED, FIXTURE_PASSPHRASE);

    service.unlock(alice, 's1', id, FIXTURE_PASSPHRASE);

    expect(service.resolveForGit(alice, 's1', id, { touch: true })).toEqual({
      kind: 'ssh',
      key: expect.any(UnlockedKey)
    });
    expect(() => service.resolveForGit(alice, 's2', id, { touch: true })).toThrow(
      expect.objectContaining({ code: 'key-locked' })
    );
  });

  it('reads saved credentials when the job runs', () => {
    const id = createHttps();
    const binding = { table: 'saved_credentials' as const, recordId: id, userId: alice };
    // The token is replaced after the job was queued.
    database.db.update(savedCredentials).set({ secret: box.encrypt('ghp_new-token', binding) })
      .where(eq(savedCredentials.id, id)).run();

    expect(service.resolveForJob(alice, id, undefined)).toEqual({
      kind: 'https',
      username: 'alice',
      password: 'ghp_new-token'
    });
    const plain = createKey(PLAIN, undefined, 'Plain');
    expect(service.resolveForJob(alice, plain, undefined)).toEqual({ kind: 'ssh', key: expect.any(UnlockedKey) });
  });

  it('uses the held copy of a protected key', () => {
    const id = createKey(PROTECTED, FIXTURE_PASSPHRASE);
    service.unlock(alice, 's1', id, FIXTURE_PASSPHRASE);
    const held = unlocks.get('s1', id, { touch: false });

    // The session's unlock ends; the job's copy stays.
    unlocks.lock('s1', id);

    expect(service.resolveForJob(alice, id, held)).toEqual({ kind: 'ssh', key: held });
  });

  it('refuses a protected key with no held copy', () => {
    const id = createKey(PROTECTED, FIXTURE_PASSPHRASE);
    service.unlock(alice, 's1', id, FIXTURE_PASSPHRASE);

    expect(() => service.resolveForJob(alice, id, undefined)).toThrow(
      expect.objectContaining({ code: 'key-locked', params: { keyId: id, keyName: 'Laptop' } })
    );
    expect(() => service.resolveForJob(bob, id, undefined)).toThrow(NotFoundException);
  });

  it('gives a job the key of a protected key unlocked in the session, and nothing for others', () => {
    const https = createHttps();
    const plain = createKey(PLAIN, undefined, 'Plain');
    const locked = createKey(PROTECTED, FIXTURE_PASSPHRASE);

    expect(service.keyForJob(alice, 's1', https)).toBeUndefined();
    expect(service.keyForJob(alice, 's1', plain)).toBeUndefined();
    expect(() => service.keyForJob(alice, 's1', locked)).toThrow(
      expect.objectContaining({ code: 'key-locked', params: { keyId: locked, keyName: 'Laptop' } })
    );
    service.unlock(alice, 's1', locked, FIXTURE_PASSPHRASE);
    expect(service.keyForJob(alice, 's1', locked)).toBe(unlocks.get('s1', locked, { touch: false }));
    expect(() => service.keyForJob(bob, 's1', https)).toThrow(NotFoundException);
  });

  it('refuses a job credentials whose secret is gone', () => {
    const https = createHttps();
    database.db.update(savedCredentials).set({ secret: null }).where(eq(savedCredentials.id, https)).run();

    expect(() => service.keyForJob(alice, 's1', https)).toThrow(
      expect.objectContaining({ code: 'credentials-missing' })
    );
  });

  it('reports a wrong passphrase on unlock as a field error', () => {
    const id = createKey(PROTECTED, FIXTURE_PASSPHRASE);
    expect(() => service.unlock(alice, 's1', id, 'wrong')).toThrow(fieldError('passphrase', 'wrong-passphrase'));
    expect(unlocks.isUnlocked('s1', id)).toBe(false);
  });

  it('reports a reset secret as missing', () => {
    const https = createHttps();
    const key = createKey(PROTECTED, FIXTURE_PASSPHRASE);
    database.db.update(savedCredentials).set({ secret: null }).run();

    expect(() => service.resolveForGit(alice, 's1', https, { touch: true })).toThrow(
      expect.objectContaining({ code: 'credentials-missing' })
    );
    expect(() => service.unlock(alice, 's1', key, FIXTURE_PASSPHRASE)).toThrow(
      expect.objectContaining({ code: 'credentials-missing' })
    );
    const list = service.list(alice, 's1');
    expect(list.https[0]?.missing).toBe(true);
    expect(list.sshKeys[0]?.missing).toBe(true);
  });

  it('lists without secrets and with the session\'s unlock state', () => {
    createHttps(alice, { ...work, name: 'zeta' });
    createHttps(alice, { ...work, name: 'Alpha' });
    createHttps(bob);
    const key = createKey(PROTECTED, FIXTURE_PASSPHRASE, 'Laptop');
    createKey(PLAIN, undefined, 'desktop');
    service.unlock(alice, 's1', key, FIXTURE_PASSPHRASE);

    const list = service.list(alice, 's1');

    expect(list.https.map(entry => entry.name)).toEqual([ 'Alpha', 'zeta' ]);
    expect(list.https[0]).toEqual({ id: expect.any(Number), name: 'Alpha', username: 'alice', missing: false });
    expect(list.sshKeys.map(entry => [ entry.name, entry.unlocked ])).toEqual([ [ 'desktop', false ], [
      'Laptop',
      true
    ] ]);
    expect(service.list(alice, 's2').sshKeys.map(entry => entry.unlocked)).toEqual([ false, false ]);
    const text = JSON.stringify(list);
    expect(text).not.toContain(work.password);
    expect(text).not.toContain('fb1.');
    expect(text).not.toContain('PRIVATE KEY');
  });

  it('answers 404 for another user\'s credential', () => {
    const id = createHttps(bob);
    const key = database.db.transaction(tx =>
      service.createPastedKey(tx, bob, { name: 'K', privateKey: PROTECTED, passphrase: FIXTURE_PASSPHRASE })
    );

    expect(() => service.findOwned(alice, id)).toThrow(NotFoundException);
    expect(() => service.findOwned(alice, 9999)).toThrow(NotFoundException);
    expect(() => service.resolveForGit(alice, 's1', id, { touch: true })).toThrow(NotFoundException);
    expect(() => service.unlock(alice, 's1', key, FIXTURE_PASSPHRASE)).toThrow(NotFoundException);
    expect(service.findOwned(bob, id).id).toBe(id);
  });

  it('answers 404 when unlocking HTTPS credentials', () => {
    const id = createHttps();
    expect(() => service.unlock(alice, 's1', id, 'x')).toThrow(NotFoundException);
  });

  // Each wrong passphrase runs the key's KDF, about half a second on a CI runner; a test runs up to ten.
  describe('wrong passphrases (RC-18)', { timeout: 30_000 }, () => {
    const tooMany = expect.objectContaining({ code: 'unlock-too-many-attempts' });
    const caught = (run: () => void): ApiErrorException | undefined => {
      try {
        run();
      } catch (error) {
        return error instanceof ApiErrorException ? error : undefined;
      }
      return undefined;
    };
    const wrongTimes = (count: number, id: number, userId = alice) => {
      for (let attempt = 0; attempt < count; attempt++) {
        expect(() => service.unlock(userId, 's1', id, 'wrong')).toThrow(fieldError('passphrase', 'wrong-passphrase'));
      }
    };

    it('a sixth attempt within a minute gets too many attempts', () => {
      const id = createKey(PROTECTED, FIXTURE_PASSPHRASE);
      wrongTimes(5, id);

      expect(() => service.unlock(alice, 's1', id, 'wrong')).toThrow(tooMany);
      expect(caught(() => service.unlock(alice, 's1', id, 'wrong'))?.getStatus()).toBe(429);
      // Right or wrong: the passphrase is not even checked.
      expect(() => service.unlock(alice, 's2', id, FIXTURE_PASSPHRASE)).toThrow(tooMany);
      expect(unlocks.isUnlocked('s2', id)).toBe(false);
    });

    it('does not run the KDF once limited', () => {
      const id = createKey(PROTECTED, FIXTURE_PASSPHRASE);
      wrongTimes(5, id);
      const unlock = vi.spyOn(unlocks, 'unlock');

      expect(() => service.unlock(alice, 's1', id, FIXTURE_PASSPHRASE)).toThrow(tooMany);
      expect(unlock).not.toHaveBeenCalled();
    });

    it('limits each key on its own', () => {
      const limited = createKey(PROTECTED, FIXTURE_PASSPHRASE, 'Laptop');
      const other = createKey(PROTECTED, FIXTURE_PASSPHRASE, 'Desktop');
      wrongTimes(5, limited);

      wrongTimes(1, other);
      service.unlock(alice, 's1', other, FIXTURE_PASSPHRASE);
      expect(unlocks.isUnlocked('s1', other)).toBe(true);
    });

    it('does not count an attempt on another user\'s key', () => {
      const id = createKey(PROTECTED, FIXTURE_PASSPHRASE);
      for (let attempt = 0; attempt < 6; attempt++) {
        expect(() => service.unlock(bob, 's9', id, 'wrong')).toThrow(NotFoundException);
      }

      service.unlock(alice, 's1', id, FIXTURE_PASSPHRASE);
      expect(unlocks.isUnlocked('s1', id)).toBe(true);
    });

    it('clears the count after a correct passphrase', () => {
      const id = createKey(PROTECTED, FIXTURE_PASSPHRASE);
      wrongTimes(4, id);
      service.unlock(alice, 's1', id, FIXTURE_PASSPHRASE);

      wrongTimes(5, id);
      expect(() => service.unlock(alice, 's1', id, 'wrong')).toThrow(tooMany);
    });

    it('counts no attempt when the secret is missing', () => {
      const id = createKey(PROTECTED, FIXTURE_PASSPHRASE);
      database.db.update(savedCredentials).set({ secret: null }).run();

      for (let attempt = 0; attempt < 6; attempt++) {
        expect(() => service.unlock(alice, 's1', id, 'wrong')).toThrow(
          expect.objectContaining({ code: 'credentials-missing' })
        );
      }
      expect(attempts.size).toBe(0);
    });
  });
});
