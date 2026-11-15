import { Database, repositories } from '@front-burner/server-core-database';
import { eq } from 'drizzle-orm';
import { insertRepository, insertUser } from '../testing/fixtures';
import { createTestDatabase } from '../testing/test-database';
import { InstanceRepositories } from './instance-repositories';

describe('InstanceRepositories', () => {
  let database: Database;
  let instance: InstanceRepositories;
  let alice: number;
  let bob: number;

  const statusOf = (id: number) =>
    database.db.select({ status: repositories.status, errorCode: repositories.errorCode })
      .from(repositories).where(eq(repositories.id, id)).get();

  beforeEach(() => {
    database = createTestDatabase();
    instance = new InstanceRepositories(database);
    alice = insertUser(database, 'alice@example.com');
    bob = insertUser(database, 'bob@example.com');
  });

  afterEach(() => database.sqlite.close());

  it('lists the ready repositories of every user', () => {
    const handbook = insertRepository(database, alice, { name: 'handbook' });
    insertRepository(database, alice, { name: 'cloning', status: 'cloning' });
    const notes = insertRepository(database, bob, { name: 'notes' });

    expect(instance.ready()).toEqual([ { id: handbook, userId: alice }, { id: notes, userId: bob } ]);
  });

  it('marks a repository damaged, which lists it as that and not as ready', () => {
    const handbook = insertRepository(database, alice, { name: 'handbook' });
    insertRepository(database, bob, { name: 'failed', status: 'error', errorCode: 'clone-failed' });

    expect(instance.markDamaged(handbook)).toBe(alice);

    expect(statusOf(handbook)).toEqual({ status: 'error', errorCode: 'working-copy-missing' });
    expect(instance.damaged()).toEqual([ { id: handbook, userId: alice } ]);
    expect(instance.ready()).toEqual([]);
  });

  it('marks a repository damaged with git\'s message and no request ID', () => {
    const handbook = insertRepository(database, alice, { name: 'handbook' });
    const onStart = insertRepository(database, alice, { name: 'on-start' });

    instance.markDamaged(handbook, 'fatal: not a git repository');
    instance.markDamaged(onStart);

    const recordOf = (id: number) =>
      database.db.select({ detail: repositories.errorDetail, requestId: repositories.errorRequestId })
        .from(repositories).where(eq(repositories.id, id)).get();
    expect(recordOf(handbook)).toEqual({ detail: 'fatal: not a git repository', requestId: null });
    expect(recordOf(onStart)).toEqual({ detail: null, requestId: null });
  });

  it('marks only a ready repository of the user damaged, once', () => {
    const handbook = insertRepository(database, alice, { name: 'handbook' });
    const cloning = insertRepository(database, alice, { name: 'cloning', status: 'cloning' });

    expect(instance.markReadyDamaged(bob, handbook, 'fatal: not a git repository')).toBe(false);
    expect(instance.markReadyDamaged(alice, cloning, 'fatal: not a git repository')).toBe(false);
    expect(instance.markReadyDamaged(alice, handbook, 'fatal: not a git repository')).toBe(true);
    expect(instance.markReadyDamaged(alice, handbook, 'fatal: not a git repository')).toBe(false);

    expect(statusOf(handbook)).toEqual({ status: 'error', errorCode: 'working-copy-missing' });
    expect(statusOf(cloning)).toEqual({ status: 'cloning', errorCode: null });
  });

  it('a repair clears the error record', () => {
    const damaged = insertRepository(database, alice, { name: 'damaged' });
    instance.markDamaged(damaged, 'fatal: bad object HEAD');

    instance.markRepaired(damaged);

    expect(database.db.select().from(repositories).where(eq(repositories.id, damaged)).get())
      .toMatchObject({ status: 'ready', errorCode: null, errorDetail: null, errorRequestId: null });
  });

  it('gives no user for a repository that is gone', () => {
    expect(instance.markDamaged(999)).toBeUndefined();
  });

  it('repairs only a damaged repository', () => {
    const damaged = insertRepository(database, alice, {
      name: 'damaged',
      status: 'error',
      errorCode: 'working-copy-missing'
    });
    const failed = insertRepository(database, alice, { name: 'failed', status: 'error', errorCode: 'clone-failed' });

    instance.markRepaired(damaged);
    instance.markRepaired(failed);

    expect(statusOf(damaged)).toEqual({ status: 'ready', errorCode: null });
    expect(statusOf(failed)).toEqual({ status: 'error', errorCode: 'clone-failed' });
  });
});
