import type { Config } from '@front-burner/server-core-config';
import { SecretBox } from '@front-burner/server-core-crypto';
import { Database } from '@front-burner/server-core-database';
import { UnlockedKey } from '@front-burner/server-core-git';
import { FIXTURE_PASSPHRASE, sshKeyFixture } from '@front-burner/server-core-git/testing';
import { SessionLifecycle } from '@front-burner/server-core-security';
import { KeyUnlockStore, SavedCredentialsService } from '@front-burner/server-feature-credentials';
import { NotFoundException } from '@nestjs/common';
import { insertUser } from '../testing/fixtures';
import { createTestDatabase } from '../testing/test-database';
import { RequestCredentials } from './request-credentials';

const box = new SecretBox('request-credentials-spec-key-0123456789abcdef');
const PROTECTED = sshKeyFixture('ed25519-passphrase');
const PLAIN = sshKeyFixture('ed25519');
const SESSION = 'session-1';

const fieldError = (path: string, code: string) =>
  expect.objectContaining({ code: 'validation-failed', fields: [ { path, code, params: {} } ] });

describe('RequestCredentials', () => {
  let database: Database;
  let unlocks: KeyUnlockStore;
  let saved: SavedCredentialsService;
  let credentials: RequestCredentials;
  let alice: { id: number; sessionId: string; };

  const saveHttps = (userId = alice.id) =>
    database.db.transaction(tx => saved.createHttps(tx, userId, { name: 'Work', username: 'alice', password: 'tok' }));
  const saveKey = (privateKey: string, passphrase?: string) =>
    database.db.transaction(tx => saved.createPastedKey(tx, alice.id, { name: 'Laptop', privateKey, passphrase }));

  beforeEach(() => {
    database = createTestDatabase();
    unlocks = new KeyUnlockStore({ keyUnlockIdleMs: 3_600_000 } as Config, new SessionLifecycle());
    saved = new SavedCredentialsService(database, box, unlocks);
    credentials = new RequestCredentials(saved, unlocks);
    alice = { id: insertUser(database, 'alice@x.io'), sessionId: SESSION };
  });

  afterEach(() => {
    unlocks.onModuleDestroy();
    database.sqlite.close();
  });

  it('connects anonymously without credentials', () => {
    expect(credentials.resolve(alice, 'https', { mode: 'none' })).toEqual({
      git: { kind: 'none' },
      savedId: undefined,
      generated: false,
      protectedKey: false
    });
  });

  it('uses saved HTTPS credentials', () => {
    const id = saveHttps();
    expect(credentials.resolve(alice, 'https', { mode: 'saved', credentialId: id })).toEqual({
      git: { kind: 'https', username: 'alice', password: 'tok' },
      savedId: id,
      generated: false,
      protectedKey: false
    });
  });

  it('uses a saved key without a passphrase', () => {
    const id = saveKey(PLAIN);
    const resolved = credentials.resolve(alice, 'ssh', { mode: 'saved', credentialId: id });
    expect(resolved).toMatchObject({ git: { kind: 'ssh' }, savedId: id, generated: false, protectedKey: false });
  });

  it('says a saved key was generated', () => {
    const { key } = saved.generateKey(alice.id, 'Generated', 'front-burner@test');
    expect(credentials.resolve(alice, 'ssh', { mode: 'saved', credentialId: key.id }).generated).toBe(true);
  });

  it('unlocks a protected key with the passphrase and keeps it unlocked', () => {
    const id = saveKey(PROTECTED, FIXTURE_PASSPHRASE);

    const resolved = credentials.resolve(alice, 'ssh', {
      mode: 'saved',
      credentialId: id,
      passphrase: FIXTURE_PASSPHRASE
    });

    expect(resolved).toMatchObject({ savedId: id, protectedKey: true });
    expect(resolved.git.kind === 'ssh' && resolved.git.key).toBeInstanceOf(UnlockedKey);
    expect(unlocks.isUnlocked(SESSION, id)).toBe(true);
    expect(credentials.resolve(alice, 'ssh', { mode: 'saved', credentialId: id }).protectedKey).toBe(true);
  });

  it('asks for the passphrase of a locked key', () => {
    const id = saveKey(PROTECTED, FIXTURE_PASSPHRASE);
    expect(() => credentials.resolve(alice, 'ssh', { mode: 'saved', credentialId: id })).toThrow(
      fieldError('credentials.passphrase', 'passphrase-required')
    );
  });

  it('reports a wrong passphrase of a saved key on its field', () => {
    const id = saveKey(PROTECTED, FIXTURE_PASSPHRASE);
    expect(() => credentials.resolve(alice, 'ssh', { mode: 'saved', credentialId: id, passphrase: 'wrong' })).toThrow(
      fieldError('credentials.passphrase', 'wrong-passphrase')
    );
    expect(unlocks.isUnlocked(SESSION, id)).toBe(false);
  });

  it('refuses an HTTPS credential for an SSH URL', () => {
    const id = saveHttps();
    expect(() => credentials.resolve(alice, 'ssh', { mode: 'saved', credentialId: id })).toThrow(
      fieldError('credentials', 'kind-mismatch')
    );
  });

  it('refuses a key for an HTTPS URL', () => {
    const id = saveKey(PLAIN);
    expect(() => credentials.resolve(alice, 'https', { mode: 'saved', credentialId: id })).toThrow(
      fieldError('credentials', 'kind-mismatch')
    );
  });

  it('answers 404 for another user\'s credential', () => {
    const bob = insertUser(database, 'bob@x.io');
    const id = saveHttps(bob);
    expect(() => credentials.resolve(alice, 'https', { mode: 'saved', credentialId: id })).toThrow(NotFoundException);
  });

  it('uses new HTTPS credentials in memory', () => {
    const resolved = credentials.resolve(alice, 'https', {
      mode: 'new-https',
      name: 'Work',
      username: 'alice',
      password: 'tok'
    });
    expect(resolved).toEqual({
      git: { kind: 'https', username: 'alice', password: 'tok' },
      savedId: undefined,
      generated: false,
      protectedKey: false
    });
    expect(saved.list(alice.id, SESSION).https).toEqual([]);
  });

  it('unlocks a pasted key in memory', () => {
    const resolved = credentials.resolve(alice, 'ssh', {
      mode: 'new-ssh-key',
      name: 'Laptop',
      privateKey: PROTECTED,
      passphrase: FIXTURE_PASSPHRASE
    });
    expect(resolved).toMatchObject({ git: { kind: 'ssh' }, savedId: undefined, protectedKey: true });
    expect(saved.list(alice.id, SESSION).sshKeys).toEqual([]);
  });

  it.each([
    [ PROTECTED, undefined, 'credentials.passphrase', 'passphrase-required' ],
    [ sshKeyFixture('dsa'), undefined, 'credentials.privateKey', 'unsupported-type' ],
    [ 'not a key', undefined, 'credentials.privateKey', 'invalid-key' ],
    [ PLAIN, 'secret', 'credentials.passphrase', 'passphrase-not-needed' ]
  ])('reports the problems of a pasted key on its field (%#)', (privateKey, passphrase, path, code) => {
    expect(() => credentials.resolve(alice, 'ssh', { mode: 'new-ssh-key', name: 'Laptop', privateKey, passphrase }))
      .toThrow(fieldError(path, code));
  });
});
