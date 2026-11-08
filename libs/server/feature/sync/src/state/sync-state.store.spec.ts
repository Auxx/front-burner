import { Database, repositories } from '@front-burner/server-core-database';
import { eq } from 'drizzle-orm';
import { insertRepository, insertUser } from '../testing/fixtures';
import { createTestDatabase } from '../testing/test-database';
import { SyncStateStore } from './sync-state.store';

describe('SyncStateStore', () => {
  let database: Database;
  let store: SyncStateStore;
  let repositoryId: number;

  beforeEach(() => {
    database = createTestDatabase();
    store = new SyncStateStore(database);
    repositoryId = insertRepository(database, insertUser(database, 'a@example.com'), { name: 'notes' });
  });

  afterEach(() => database.sqlite.close());

  it('has no problem until one is set', () => {
    expect(store.fetchProblem(repositoryId)).toBeNull();
    expect(store.setFetchProblem(repositoryId, { code: 'credentials-refused', params: { host: 'h' } })).toBe(true);
    expect(store.fetchProblem(repositoryId)).toEqual({ code: 'credentials-refused', params: { host: 'h' } });
  });

  it('says when the problem changed', () => {
    expect(store.setFetchProblem(repositoryId, null)).toBe(false);
    const problem = { code: 'key-locked', params: { name: 'k' } };
    expect(store.setFetchProblem(repositoryId, problem)).toBe(true);
    expect(store.setFetchProblem(repositoryId, { ...problem, params: { name: 'k' } })).toBe(false);
    expect(store.setFetchProblem(repositoryId, { code: 'key-locked', params: { name: 'other' } })).toBe(true);
    expect(store.setFetchProblem(repositoryId, null)).toBe(true);
    expect(store.fetchProblem(repositoryId)).toBeNull();
    expect(store.setFetchProblem(repositoryId, null)).toBe(false);
  });

  it('is deleted with its repository', () => {
    store.setFetchProblem(repositoryId, { code: 'x', params: {} });
    database.db.delete(repositories).where(eq(repositories.id, repositoryId)).run();
    expect(store.fetchProblem(repositoryId)).toBeNull();
    expect(database.sqlite.prepare('select count(*) as n from sync_state').get()).toEqual({ n: 0 });
  });
});
