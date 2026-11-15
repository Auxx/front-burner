import { Database } from '@front-burner/server-core-database';
import { insertRepository, insertUser, repositoryRow } from '../testing/fixtures';
import { createTestDatabase } from '../testing/test-database';
import { RepositoryQueries, toDetails, toSummary } from './repository-queries';

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

  describe('all', () => {
    it('sorts by name ignoring case', () => {
      for (const name of [ 'gamma', 'Beta', 'alpha' ]) {
        insertRepository(database, alice, { name });
      }

      expect(queries.all(alice).map(row => row.name)).toEqual([ 'alpha', 'Beta', 'gamma' ]);
    });

    it('sorts non-ASCII names ignoring case', () => {
      for (const name of [ 'zeta', 'éclair-notes', 'Éclair', 'echo' ]) {
        insertRepository(database, alice, { name });
      }

      expect(queries.all(alice).map(row => row.name)).toEqual([ 'echo', 'Éclair', 'éclair-notes', 'zeta' ]);
    });

    it('ties by ID', () => {
      // Adding refuses this pair (AR-15), but the ASCII-only index of the
      // database lets it in, as rows from before that check might be.
      const first = insertRepository(database, alice, { name: 'über' });
      const second = insertRepository(database, alice, { name: 'Über' });

      expect(queries.all(alice).map(row => row.id)).toEqual([ first, second ]);
    });

    it('lists every status', () => {
      // The database has no `needs-confirmation`: the MVP never produces it (DS-21).
      insertRepository(database, alice, { name: 'a', status: 'cloning' });
      insertRepository(database, alice, { name: 'b', status: 'ready' });
      insertRepository(database, alice, { name: 'c', status: 'error', errorCode: 'clone-failed' });

      expect(queries.all(alice).map(row => row.status)).toEqual([ 'cloning', 'ready', 'error' ]);
    });

    it('lists only the user\'s own', () => {
      const bob = insertUser(database, 'bob@example.com');
      insertRepository(database, alice, { name: 'handbook' });
      insertRepository(database, bob, { name: 'secret' });

      expect(queries.all(alice).map(row => [ row.userId, row.name ])).toEqual([ [ alice, 'handbook' ] ]);
    });

    it('does not change the last access time', () => {
      const at = new Date(Date.UTC(2026, 9, 26, 10));
      const id = insertRepository(database, alice, { name: 'handbook', lastAccessedAt: at });

      expect(queries.all(alice)[0]?.lastAccessedAt).toEqual(at);
      expect(queries.find(alice, id)?.lastAccessedAt).toEqual(at);
    });

    it('answers an empty list for a user without repositories', () => {
      expect(queries.all(alice)).toEqual([]);
    });
  });

  it('honours a smaller limit', () => {
    insertRepository(database, alice, { name: 'a' });
    insertRepository(database, alice, { name: 'b' });
    expect(queries.recent(alice, 1)).toHaveLength(1);
  });
});

const failedRow = repositoryRow({
  id: 3,
  remoteUrl: 'https://u:t@github.com/acme/handbook.git',
  status: 'error',
  errorCode: 'clone-failed',
  errorDetail: 'fatal: repository not found',
  errorRequestId: 'request-1',
  lastAccessedAt: new Date(Date.UTC(2026, 9, 26, 10))
});

describe('toDetails', () => {
  it('answers the clone mode, level and date added', () => {
    const details = toDetails(
      { ...failedRow, gitLevel: 'simple', createdAt: new Date(Date.UTC(2026, 9, 20, 8)) },
      []
    );

    expect(details).toMatchObject({
      cloneMode: 'full',
      branch: null,
      gitLevel: 'simple',
      addedAt: '2026-10-20T08:00:00.000Z'
    });
    expect(details.summary).toEqual(toSummary(failedRow, []));
  });

  it('answers the warnings in its summary', () => {
    const ready = { ...failedRow, status: 'ready' } as const;

    expect(toDetails(ready, [ 'key-locked' ]).summary.warnings).toEqual([ 'key-locked' ]);
  });

  it('answers the branch of a single-branch clone', () => {
    expect(toDetails({ ...failedRow, cloneMode: 'single-branch', branch: 'main' }, []))
      .toMatchObject({ cloneMode: 'single-branch', branch: 'main' });
  });

  it('never answers a full clone\'s branch', () => {
    expect(toDetails({ ...failedRow, cloneMode: 'full', branch: 'main' }, [])).toMatchObject({ branch: null });
  });

  it('answers no branch for a single-branch row that lost it', () => {
    expect(toDetails({ ...failedRow, cloneMode: 'single-branch', branch: null }, []))
      .toMatchObject({ cloneMode: 'single-branch', branch: null });
  });

  it('answers the error record of a failed clone', () => {
    expect(toDetails(failedRow, []))
      .toMatchObject({ errorDetail: 'fatal: repository not found', errorRequestId: 'request-1' });
  });

  it('answers no error record when ready', () => {
    // Plan 105 clears the record; a stale one is still never answered outside `error`.
    const ready = { ...failedRow, status: 'ready' } as const;

    expect(toDetails(ready, []))
      .toMatchObject({ summary: { error: null }, errorDetail: null, errorRequestId: null });
  });

  it('answers the remote without credentials', () => {
    const details = toDetails(failedRow, []);

    expect(details.summary.remote).toBe('github.com/acme/handbook');
    expect(JSON.stringify(details)).not.toContain('u:t');
  });
});

describe('toSummary', () => {
  it('shows the remote without credentials and the time as ISO', () => {
    const summary = toSummary(failedRow, []);

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

  it('answers no error code outside the error status, even a stale one', () => {
    for (const status of [ 'ready', 'cloning' ] as const) {
      expect(toSummary({ ...failedRow, status }, []).error).toBeNull();
    }
  });
});
