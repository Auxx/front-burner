import { Database } from '@front-burner/server-core-database';
import { insertRepository, insertUser } from '../testing/fixtures';
import { createTestDatabase } from '../testing/test-database';
import { RepositoryQueries, toSummary } from './repository-queries';

describe('RepositoryQueries', () => {
  let database: Database;
  let queries: RepositoryQueries;
  let alice: number;

  beforeEach(() => {
    database = createTestDatabase();
    queries = new RepositoryQueries(database);
    alice = insertUser(database, 'alice@example.com');
  });

  afterEach(() => database.sqlite.close());

  it('indexes every repository of the user by name and remote', () => {
    const bob = insertUser(database, 'bob@example.com');
    insertRepository(database, alice, { name: 'Handbook', remoteUrl: 'https://GitHub.com/acme/handbook.git/' });
    insertRepository(database, alice, { name: 'notes', remoteUrl: 'git@github.com:acme/notes.git' });
    insertRepository(database, bob, { name: 'secret' });

    expect(queries.index(alice)).toEqual({
      repositories: [
        { name: 'Handbook', remoteKey: 'github.com/acme/handbook' },
        { name: 'notes', remoteKey: 'github.com/acme/notes' }
      ]
    });
  });

  it('returns at most 10, most recent first', () => {
    for (let i = 0; i < 12; i++) {
      insertRepository(database, alice, { name: `repo-${i}`, lastAccessedAt: new Date(i * 1000) });
    }

    expect(queries.recent(alice).map(row => row.name)).toEqual(
      [ 11, 10, 9, 8, 7, 6, 5, 4, 3, 2 ].map(i => `repo-${i}`)
    );
  });

  it('leaves out the excluded repository and still returns the limit', () => {
    const ids = Array.from(
      { length: 11 },
      (_, i) => insertRepository(database, alice, { name: `repo-${i}`, lastAccessedAt: new Date(i * 1000) })
    );

    expect(queries.recent(alice, 10, ids[10]).map(row => row.name)).toEqual(
      [ 9, 8, 7, 6, 5, 4, 3, 2, 1, 0 ].map(i => `repo-${i}`)
    );
  });

  it('orders ties by name ignoring case', () => {
    const at = new Date(5000);
    for (const name of [ 'beta', 'Charlie', 'alpha', 'Bravo' ]) {
      insertRepository(database, alice, { name, lastAccessedAt: at });
    }

    expect(queries.recent(alice).map(row => row.name)).toEqual([ 'alpha', 'beta', 'Bravo', 'Charlie' ]);
    expect(queries.recent(alice).map(row => row.name)).toEqual([ 'alpha', 'beta', 'Bravo', 'Charlie' ]);
  });

  it('returns only the user\'s own repositories', () => {
    const bob = insertUser(database, 'bob@example.com');
    insertRepository(database, alice, { name: 'handbook', lastAccessedAt: new Date(1) });
    insertRepository(database, bob, { name: 'handbook', lastAccessedAt: new Date(2) });
    insertRepository(database, bob, { name: 'notes', lastAccessedAt: new Date(3) });

    expect(queries.recent(alice).map(row => [ row.userId, row.name ])).toEqual([ [ alice, 'handbook' ] ]);
    expect(queries.recent(bob)).toHaveLength(2);
  });

  it('finds only the user\'s own repository', () => {
    const bob = insertUser(database, 'bob@example.com');
    const own = insertRepository(database, alice, { name: 'handbook' });
    const other = insertRepository(database, bob, { name: 'secret' });

    expect(queries.find(alice, own)?.name).toBe('handbook');
    expect(queries.find(alice, other)).toBeUndefined();
    expect(queries.find(alice, 999)).toBeUndefined();
  });

  it('marks a ready repository as opened', () => {
    const id = insertRepository(database, alice, { name: 'handbook' });
    const now = new Date(Date.UTC(2026, 9, 28, 12));

    expect(queries.markOpened(alice, id, now)?.lastAccessedAt).toEqual(now);
    expect(queries.find(alice, id)?.lastAccessedAt).toEqual(now);
  });

  it('does not mark a cloning repository as opened', () => {
    const id = insertRepository(database, alice, { name: 'handbook', status: 'cloning' });

    const row = queries.markOpened(alice, id, new Date(Date.UTC(2026, 9, 28, 12)));

    expect(row?.status).toBe('cloning');
    expect(row?.lastAccessedAt).toEqual(new Date(0));
  });

  it('does not mark another user\'s repository as opened', () => {
    const bob = insertUser(database, 'bob@example.com');
    const id = insertRepository(database, bob, { name: 'secret' });

    expect(queries.markOpened(alice, id, new Date(5000))).toBeUndefined();
    expect(queries.find(bob, id)?.lastAccessedAt).toEqual(new Date(0));
  });

  it('honours a smaller limit', () => {
    insertRepository(database, alice, { name: 'a' });
    insertRepository(database, alice, { name: 'b' });
    expect(queries.recent(alice, 1)).toHaveLength(1);
  });
});

describe('toSummary', () => {
  it('shows the remote without credentials and the time as ISO', () => {
    const summary = toSummary({
      id: 3,
      userId: 1,
      name: 'handbook',
      remoteUrl: 'https://u:t@github.com/acme/handbook.git',
      credentialId: null,
      cloneMode: 'full',
      branch: null,
      gitLevel: 'advanced',
      status: 'error',
      errorCode: 'clone-failed',
      createdAt: new Date(0),
      lastAccessedAt: new Date(Date.UTC(2026, 9, 26, 10))
    });

    expect(summary).toEqual({
      id: 3,
      name: 'handbook',
      remote: 'github.com/acme/handbook',
      status: 'error',
      error: 'clone-failed',
      warnings: [],
      lastAccessedAt: '2026-10-26T10:00:00.000Z'
    });
  });
});
