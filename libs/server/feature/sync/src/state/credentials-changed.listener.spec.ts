import { Database } from '@front-burner/server-core-database';
import { RepositoryCredentialsChanges } from '@front-burner/server-feature-repositories';
import { Logger } from '@nestjs/common';
import { insertRepository, insertUser } from '../testing/fixtures';
import { createTestDatabase } from '../testing/test-database';
import { CredentialsChangedListener } from './credentials-changed.listener';
import { SyncStateStore } from './sync-state.store';

describe('CredentialsChangedListener', () => {
  let database: Database;
  let store: SyncStateStore;
  let changes: RepositoryCredentialsChanges;
  let listener: CredentialsChangedListener;
  let repositoryId: number;

  beforeEach(() => {
    database = createTestDatabase();
    store = new SyncStateStore(database);
    changes = new RepositoryCredentialsChanges();
    listener = new CredentialsChangedListener(changes, store);
    repositoryId = insertRepository(database, insertUser(database, 'a@example.com'), { name: 'notes' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    listener.onModuleDestroy();
    database.sqlite.close();
  });

  it('changing the credentials clears push-not-allowed', () => {
    store.remoteFailed(repositoryId, 'push', { code: 'push-not-allowed', params: { branch: 'main' } });

    changes.notifyChanged([ repositoryId ]);

    expect(store.pushProblem(repositoryId)).toBeNull();
  });

  it('changing the credentials keeps credentials-refused', () => {
    const refused = { code: 'credentials-refused', params: { host: 'h' } };
    store.remoteFailed(repositoryId, 'fetch', refused);
    store.remoteFailed(repositoryId, 'push', refused);

    changes.notifyChanged([ repositoryId ]);

    expect(store.remoteProblems(repositoryId)).toEqual({ fetch: refused, push: refused });
  });

  it('logs a failure instead of letting RxJS throw it later, and keeps listening', () => {
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(store, 'credentialsChanged').mockImplementationOnce(() => {
      throw new Error('SQLITE_BUSY');
    });
    store.remoteFailed(repositoryId, 'push', { code: 'push-not-allowed', params: {} });

    changes.notifyChanged([ repositoryId ]);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('SQLITE_BUSY'));
    changes.notifyChanged([ repositoryId ]);

    expect(store.pushProblem(repositoryId)).toBeNull();
  });

  it('stops listening when the module is destroyed', () => {
    store.remoteFailed(repositoryId, 'push', { code: 'push-not-allowed', params: {} });
    listener.onModuleDestroy();

    changes.notifyChanged([ repositoryId ]);

    expect(store.pushProblem(repositoryId)).not.toBeNull();
  });
});
