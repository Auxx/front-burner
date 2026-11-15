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

  it('keeps the record through a merge', () => {
    expect(store.record(repositoryId)).toEqual({ recordedCommit: null, mergeCommit: null, applying: false });
    store.startMerge(repositoryId, 'aaa');
    expect(store.record(repositoryId)).toEqual({ recordedCommit: 'aaa', mergeCommit: null, applying: true });
    store.mergeStopped(repositoryId);
    expect(store.record(repositoryId)).toEqual({ recordedCommit: 'aaa', mergeCommit: null, applying: false });
    store.mergeCommitted(repositoryId, 'mmm');
    expect(store.record(repositoryId)).toEqual({ recordedCommit: 'aaa', mergeCommit: 'mmm', applying: false });
  });

  it('writes the whole record with its recorded commit, also without a row', () => {
    store.mergeCommitted(repositoryId, 'mmm', 'aaa');
    expect(store.record(repositoryId)).toEqual({ recordedCommit: 'aaa', mergeCommit: 'mmm', applying: false });
    store.startMerge(repositoryId, 'bbb');
    store.mergeCommitted(repositoryId, 'nnn', 'bbb');
    expect(store.record(repositoryId)).toEqual({ recordedCommit: 'bbb', mergeCommit: 'nnn', applying: false });
    expect(store.earlierRecordedCommit(repositoryId)).toBeNull();
  });

  it('forgets it', () => {
    store.startMerge(repositoryId, 'aaa');
    store.mergeCommitted(repositoryId, 'mmm');
    store.forgetRecord(repositoryId);
    expect(store.record(repositoryId)).toEqual({ recordedCommit: null, mergeCommit: null, applying: false });
    expect(() => store.forgetRecord(repositoryId + 1)).not.toThrow();
  });

  it('replaces the record of an earlier merge once committed', () => {
    store.startMerge(repositoryId, 'aaa');
    store.mergeCommitted(repositoryId, 'mmm');
    store.startMerge(repositoryId, 'bbb');
    expect(store.record(repositoryId)).toEqual({ recordedCommit: 'bbb', mergeCommit: null, applying: true });
    store.mergeCommitted(repositoryId, 'nnn');
    expect(store.record(repositoryId)).toEqual({ recordedCommit: 'bbb', mergeCommit: 'nnn', applying: false });
    expect(store.restoreEarlier(repositoryId)).toBeNull();
  });

  it('gives the earlier record back', () => {
    store.startMerge(repositoryId, 'aaa');
    store.mergeCommitted(repositoryId, 'mmm');
    store.startMerge(repositoryId, 'bbb');
    expect(store.restoreEarlier(repositoryId)).toBe('aaa');
    expect(store.record(repositoryId)).toEqual({ recordedCommit: 'aaa', mergeCommit: 'mmm', applying: false });
    store.startMerge(repositoryId, 'ccc');
    store.forgetRecord(repositoryId);
    expect(store.restoreEarlier(repositoryId)).toBeNull();
    expect(store.record(repositoryId)).toEqual({ recordedCommit: null, mergeCommit: null, applying: false });
  });

  describe('remote problems (RM-8)', () => {
    const refused = { code: 'credentials-refused', params: { host: 'h' } };
    const notAllowed = { code: 'push-not-allowed', params: { branch: 'main' } };
    const hostKey = { code: 'host-key-changed', params: { host: 'h' } };
    const unreachable = { code: 'host-unreachable', params: { host: 'h' } };

    it('a refused push is stored', () => {
      expect(store.remoteFailed(repositoryId, 'push', refused)).toBe(true);
      expect(store.pushProblem(repositoryId)).toEqual(refused);
      expect(store.remoteProblems(repositoryId)).toEqual({ fetch: null, push: refused });
    });

    it('keeps no remote messages, so that a new wording is no change', () => {
      const withMessages = (remoteMessages: string) => ({
        ...notAllowed,
        params: { ...notAllowed.params, remoteMessages }
      });

      expect(store.remoteFailed(repositoryId, 'push', withMessages('Request a1: denied'))).toBe(true);
      expect(store.remoteFailed(repositoryId, 'push', withMessages('Request b2: denied'))).toBe(false);

      expect(store.pushProblem(repositoryId)).toEqual(notAllowed);
    });

    it('a rejected push is not a problem', () => {
      expect(store.remoteFailed(repositoryId, 'push', { code: 'push-non-fast-forward', params: {} })).toBe(false);
      expect(store.remoteFailed(repositoryId, 'push', { code: 'push-rejected', params: {} })).toBe(false);
      expect(store.pushProblem(repositoryId)).toBeNull();
    });

    it('a fetch does not clear a push\'s problem', () => {
      store.remoteFailed(repositoryId, 'push', refused);
      store.remoteFailed(repositoryId, 'fetch', hostKey);
      expect(store.remoteSucceeded(repositoryId, 'fetch')).toBe(true);
      expect(store.remoteProblems(repositoryId)).toEqual({ fetch: null, push: refused });
    });

    it('a push clears a fetch\'s problem', () => {
      store.remoteFailed(repositoryId, 'fetch', refused);
      expect(store.remoteSucceeded(repositoryId, 'push')).toBe(true);
      expect(store.remoteProblems(repositoryId)).toEqual({ fetch: null, push: null });
    });

    it('a successful push clears its own problem', () => {
      store.remoteFailed(repositoryId, 'push', hostKey);
      expect(store.remoteSucceeded(repositoryId, 'push')).toBe(true);
      expect(store.pushProblem(repositoryId)).toBeNull();
    });

    it('a push\'s problem replaces the last one, and only a push may not be allowed', () => {
      store.remoteFailed(repositoryId, 'push', refused);
      expect(store.remoteFailed(repositoryId, 'push', notAllowed)).toBe(true);
      expect(store.pushProblem(repositoryId)).toEqual(notAllowed);
      expect(store.remoteFailed(repositoryId, 'fetch', notAllowed)).toBe(false);
      expect(store.remoteProblems(repositoryId).fetch).toBeNull();
    });

    it('changing the credentials clears push-not-allowed', () => {
      store.remoteFailed(repositoryId, 'push', notAllowed);
      expect(store.credentialsChanged(repositoryId)).toBe(true);
      expect(store.pushProblem(repositoryId)).toBeNull();
    });

    it('changing the credentials keeps credentials-refused of a fetch', () => {
      store.remoteFailed(repositoryId, 'fetch', refused);
      store.remoteFailed(repositoryId, 'push', refused);
      expect(store.credentialsChanged(repositoryId)).toBe(false);
      expect(store.remoteProblems(repositoryId)).toEqual({ fetch: refused, push: refused });
    });

    it('a network failure keeps the stored problems', () => {
      store.remoteFailed(repositoryId, 'fetch', refused);
      store.remoteFailed(repositoryId, 'push', notAllowed);
      expect(store.remoteFailed(repositoryId, 'fetch', unreachable)).toBe(false);
      expect(store.remoteFailed(repositoryId, 'push', unreachable)).toBe(false);
      expect(store.remoteProblems(repositoryId)).toEqual({ fetch: refused, push: notAllowed });
    });

    it('reports whether anything changed', () => {
      expect(store.remoteSucceeded(repositoryId, 'push')).toBe(false);
      expect(store.credentialsChanged(repositoryId)).toBe(false);
      expect(store.remoteFailed(repositoryId, 'fetch', refused)).toBe(true);
      expect(store.remoteFailed(repositoryId, 'fetch', { ...refused, params: { host: 'h' } })).toBe(false);
      expect(store.remoteFailed(repositoryId, 'fetch', { ...refused, params: { host: 'other' } })).toBe(true);
      expect(store.remoteSucceeded(repositoryId, 'fetch')).toBe(true);
      expect(store.remoteSucceeded(repositoryId, 'fetch')).toBe(false);
      expect(store.setPushProblem(repositoryId, refused)).toBe(true);
      expect(store.setPushProblem(repositoryId, refused)).toBe(false);
      expect(store.setPushProblem(repositoryId, null)).toBe(true);
    });

    it('leaves the fetch status of GA-35 alone', () => {
      store.setFetchProblem(repositoryId, unreachable);
      store.remoteFailed(repositoryId, 'push', refused);
      store.remoteSucceeded(repositoryId, 'push');
      expect(store.fetchProblem(repositoryId)).toEqual(unreachable);
    });
  });

  it('is deleted with its repository', () => {
    store.setFetchProblem(repositoryId, { code: 'x', params: {} });
    database.db.delete(repositories).where(eq(repositories.id, repositoryId)).run();
    expect(store.fetchProblem(repositoryId)).toBeNull();
    expect(database.sqlite.prepare('select count(*) as n from sync_state').get()).toEqual({ n: 0 });
  });
});
