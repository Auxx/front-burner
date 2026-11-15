import type { Config } from '@front-burner/server-core-config';
import { SecretBox } from '@front-burner/server-core-crypto';
import { Database, repositories, Repository } from '@front-burner/server-core-database';
import { EventsHub } from '@front-burner/server-core-events';
import { FIXTURE_PASSPHRASE, sshKeyFixture } from '@front-burner/server-core-git/testing';
import { SessionLifecycle } from '@front-burner/server-core-security';
import { KeyUnlockStore, SavedCredentialsService, UnlockAttempts } from '@front-burner/server-feature-credentials';
import { eq } from 'drizzle-orm';
import { insertRepository, insertUser } from '../testing/fixtures';
import { createTestDatabase } from '../testing/test-database';
import { RemoteProblems, RemoteProblemsSource } from './remote-problems-source';
import { RepositoryWarnings } from './repository-warnings';

const box = new SecretBox('repository-warnings-spec-key-0123456789abcdef');
const PROTECTED = sshKeyFixture('ed25519-passphrase');
const PLAIN = sshKeyFixture('ed25519');
const SESSION = 'session-1';
const OTHER_SESSION = 'session-2';

const problem = (code: string) => ({ code, params: {} });

describe('RepositoryWarnings', () => {
  let database: Database;
  let unlocks: KeyUnlockStore;
  let saved: SavedCredentialsService;
  let source: RemoteProblemsSource;
  let stored: Map<number, RemoteProblems>;
  let warnings: RepositoryWarnings;
  let alice: number;

  const row = (id: number): Repository =>
    database.db.select().from(repositories).where(eq(repositories.id, id)).get() as Repository;
  const saveKey = (privateKey: string, passphrase?: string) =>
    database.db.transaction(tx => saved.createPastedKey(tx, alice, { name: 'Laptop', privateKey, passphrase }));
  const forOne = (id: number, sessionId = SESSION) => warnings.forRow(sessionId, row(id));

  const newUnlocks = () =>
    new KeyUnlockStore({ keyUnlockIdleMs: 3_600_000 } as Config, new SessionLifecycle(), new EventsHub());

  beforeEach(() => {
    database = createTestDatabase();
    unlocks = newUnlocks();
    saved = new SavedCredentialsService(database, box, unlocks, new UnlockAttempts());
    stored = new Map();
    source = new RemoteProblemsSource();
    source.provide(ids =>
      new Map(ids.flatMap(id => (stored.has(id) ? [ [ id, stored.get(id) as RemoteProblems ] ] : [])))
    );
    warnings = new RepositoryWarnings(database, source, unlocks);
    alice = insertUser(database, 'alice@example.com');
  });

  afterEach(() => {
    unlocks.onModuleDestroy();
    database.sqlite.close();
  });

  it('has no warnings without stored problems', () => {
    expect(forOne(insertRepository(database, alice, { name: 'notes' }))).toEqual([]);
  });

  it('maps each stored problem to its warning', () => {
    const cases: [ RemoteProblems, string[] ][] = [
      [ { fetch: problem('credentials-refused'), push: null }, [ 'credentials-refused' ] ],
      [ { fetch: null, push: problem('credentials-refused') }, [ 'credentials-refused' ] ],
      [ { fetch: null, push: problem('push-not-allowed') }, [ 'cannot-push' ] ],
      [ { fetch: problem('host-key-changed'), push: null }, [ 'host-key-changed' ] ],
      [ { fetch: null, push: problem('host-key-changed') }, [ 'host-key-changed' ] ],
      // In the order of RM-8's table, whichever operation left them.
      [ { fetch: problem('host-key-changed'), push: problem('push-not-allowed') }, [
        'cannot-push',
        'host-key-changed'
      ] ],
      [ { fetch: problem('credentials-refused'), push: problem('host-key-changed') }, [
        'credentials-refused',
        'host-key-changed'
      ] ]
    ];
    cases.forEach(([ problems, expected ], i) => {
      const id = insertRepository(database, alice, { name: `repo-${i}` });
      stored.set(id, problems);
      expect(forOne(id)).toEqual(expected);
    });
  });

  it('does not repeat a warning', () => {
    const id = insertRepository(database, alice, { name: 'notes' });
    stored.set(id, { fetch: problem('credentials-refused'), push: problem('credentials-refused') });

    expect(forOne(id)).toEqual([ 'credentials-refused' ]);
  });

  it('key-locked depends on the session', () => {
    const keyId = saveKey(PROTECTED, FIXTURE_PASSPHRASE);
    const id = insertRepository(database, alice, {
      name: 'notes',
      remoteUrl: 'git@github.com:acme/notes.git',
      credentialId: keyId
    });
    saved.unlock(alice, SESSION, keyId, FIXTURE_PASSPHRASE);

    expect(forOne(id, SESSION)).toEqual([]);
    expect(forOne(id, OTHER_SESSION)).toEqual([ 'key-locked' ]);
  });

  it('a protected key is locked after a restart', () => {
    const keyId = saveKey(PROTECTED, FIXTURE_PASSPHRASE);
    const id = insertRepository(database, alice, {
      name: 'notes',
      remoteUrl: 'git@github.com:acme/notes.git',
      credentialId: keyId
    });
    saved.unlock(alice, SESSION, keyId, FIXTURE_PASSPHRASE);
    expect(forOne(id)).toEqual([]);

    // The unlocks live in memory only: a new process starts with none (RC-15).
    unlocks.onModuleDestroy();
    unlocks = newUnlocks();
    warnings = new RepositoryWarnings(database, source, unlocks);

    expect(forOne(id)).toEqual([ 'key-locked' ]);
  });

  it('a key without a passphrase is never locked', () => {
    const keyId = saveKey(PLAIN);
    const id = insertRepository(database, alice, {
      name: 'notes',
      remoteUrl: 'git@github.com:acme/notes.git',
      credentialId: keyId
    });

    expect(forOne(id)).toEqual([]);
  });

  it('puts key-locked after the stored problems', () => {
    const keyId = saveKey(PROTECTED, FIXTURE_PASSPHRASE);
    const id = insertRepository(database, alice, {
      name: 'notes',
      remoteUrl: 'git@github.com:acme/notes.git',
      credentialId: keyId
    });
    stored.set(id, { fetch: problem('host-key-changed'), push: null });

    expect(forOne(id)).toEqual([ 'host-key-changed', 'key-locked' ]);
  });

  it('a repository in error has no warnings', () => {
    const keyId = saveKey(PROTECTED, FIXTURE_PASSPHRASE);
    for (const status of [ 'error', 'cloning' ] as const) {
      const id = insertRepository(database, alice, {
        name: status,
        status,
        errorCode: status === 'error' ? 'clone-failed' : null,
        remoteUrl: 'git@github.com:acme/notes.git',
        credentialId: keyId
      });
      stored.set(id, { fetch: problem('credentials-refused'), push: problem('push-not-allowed') });

      expect(forOne(id)).toEqual([]);
    }
  });

  it('reads the problems of all repositories at once', () => {
    const ids = Array.from({ length: 5 }, (_, i) => insertRepository(database, alice, { name: `repo-${i}` }));
    const failed = insertRepository(database, alice, { name: 'failed', status: 'error', errorCode: 'clone-failed' });
    stored.set(ids[2], { fetch: problem('credentials-refused'), push: null });
    const read = vi.spyOn(source, 'read');

    const result = warnings.forRows(SESSION, [ ...ids, failed ].map(row));

    expect(read).toHaveBeenCalledTimes(1);
    // Only the ready ones: the others have no warnings to read (RM-8).
    expect(read).toHaveBeenCalledWith(ids);
    expect([ ...result.entries() ]).toEqual([
      ...ids.map(id => [ id, id === ids[2] ? [ 'credentials-refused' ] : [] ]),
      [ failed, [] ]
    ]);
  });
});
