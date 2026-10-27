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

  it('returns at most 10, most recent first', () => {
    for (let i = 0; i < 12; i++) {
      insertRepository(database, alice, { name: `repo-${i}`, lastAccessedAt: new Date(i * 1000) });
    }

    expect(queries.recent(alice).map(row => row.name)).toEqual(
      [ 11, 10, 9, 8, 7, 6, 5, 4, 3, 2 ].map(i => `repo-${i}`)
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
