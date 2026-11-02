import {
  Database,
  insertUserPreferences,
  NewRepository,
  repositories,
  users
} from '@front-burner/server-core-database';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { RepositoryQueries } from '@front-burner/server-feature-repositories';
import { createTestDatabase } from '../testing/test-database';
import { CommitAuthors } from './commit-authors';

describe('CommitAuthors', () => {
  let database: Database;
  let queries: RepositoryQueries;
  let service: CommitAuthors;
  let aliceId: number;
  let repo1Id: number;
  let repo2Id: number;

  beforeEach(() => {
    database = createTestDatabase();
    queries = new RepositoryQueries(database);
    service = new CommitAuthors(database, queries);

    const alice = database.db.insert(users).values({
      email: 'alice@example.com',
      displayName: 'Alice User',
      role: 'user',
      loginMethod: 'password',
      createdAt: new Date()
    }).returning().get();
    aliceId = alice.id;
    insertUserPreferences(database.db, alice);

    const repo1 = database.db.insert(repositories).values({
      userId: aliceId,
      name: 'repo-one',
      remoteUrl: 'https://example.com/one.git',
      cloneMode: 'full',
      gitLevel: 'advanced',
      status: 'ready',
      createdAt: new Date(),
      lastAccessedAt: new Date()
    }).returning().get();
    repo1Id = repo1.id;

    const repo2 = database.db.insert(repositories).values({
      userId: aliceId,
      name: 'repo-two',
      remoteUrl: 'https://example.com/two.git',
      cloneMode: 'full',
      gitLevel: 'advanced',
      status: 'ready',
      createdAt: new Date(),
      lastAccessedAt: new Date()
    }).returning().get();
    repo2Id = repo2.id;
  });

  afterEach(() => {
    database.sqlite.close();
  });

  it('setting the default confirms it', () => {
    expect(service.preference(aliceId)).toEqual({
      author: {
        name: 'Alice User',
        email: 'alice@example.com'
      },
      confirmed: false
    });

    const updated = service.setDefault(aliceId, {
      name: 'Alice Cooper',
      email: 'cooper@example.com'
    });

    expect(updated).toEqual({
      author: {
        name: 'Alice Cooper',
        email: 'cooper@example.com'
      },
      confirmed: true
    });
    expect(service.preference(aliceId).confirmed).toBe(true);
  });

  it('an override applies to its repository only, and removing it brings back the default', () => {
    expect(service.forRepository(aliceId, repo1Id)).toEqual({
      author: {
        name: 'Alice User',
        email: 'alice@example.com'
      },
      source: 'default',
      confirmed: false
    });

    const override = service.setOverride(aliceId, repo1Id, {
      name: 'Custom Author',
      email: 'custom@example.com'
    });

    expect(override).toEqual({
      author: {
        name: 'Custom Author',
        email: 'custom@example.com'
      },
      source: 'override',
      confirmed: false
    });

    // repo 1 has override
    expect(service.forRepository(aliceId, repo1Id)).toEqual(override);

    // repo 2 still has default
    expect(service.forRepository(aliceId, repo2Id)).toEqual({
      author: {
        name: 'Alice User',
        email: 'alice@example.com'
      },
      source: 'default',
      confirmed: false
    });

    // removing override brings back default
    const reverted = service.removeOverride(aliceId, repo1Id);
    expect(reverted).toEqual({
      author: {
        name: 'Alice User',
        email: 'alice@example.com'
      },
      source: 'default',
      confirmed: false
    });
    expect(service.forRepository(aliceId, repo1Id)).toEqual(reverted);
  });

  it('an override does not confirm', () => {
    expect(service.preference(aliceId).confirmed).toBe(false);

    service.setOverride(aliceId, repo1Id, {
      name: 'Custom Author',
      email: 'custom@example.com'
    });

    expect(service.preference(aliceId).confirmed).toBe(false);
  });

  it('confirming marks preferences confirmed', () => {
    expect(service.preference(aliceId).confirmed).toBe(false);
    service.confirm(aliceId);
    expect(service.preference(aliceId).confirmed).toBe(true);
  });

  it('throws 404 for unknown user or repository', () => {
    expect(() => service.preference(999)).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => service.setDefault(999, { name: 'A', email: 'a@b.com' })).toThrow(
      expect.objectContaining({ status: 404 })
    );
    expect(() => service.confirm(999)).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => service.forRepository(aliceId, 999)).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => service.setOverride(aliceId, 999, { name: 'A', email: 'a@b.com' })).toThrow(
      expect.objectContaining({ status: 404 })
    );
    expect(() => service.removeOverride(aliceId, 999)).toThrow(expect.objectContaining({ status: 404 }));
  });
});
