import { Database, repositories } from '@front-burner/server-core-database';
import type { EventsHub } from '@front-burner/server-core-events';
import { GitOperationError } from '@front-burner/server-core-git';
import type { PushEvent } from '@front-burner/shared-contracts';
import { eq } from 'drizzle-orm';
import { InstanceRepositories } from '../repositories/instance-repositories';
import { insertRepository, insertUser } from '../testing/fixtures';
import { createTestDatabase } from '../testing/test-database';
import { WORKING_COPY_MISSING_OUTCOME, WorkingCopyDamage } from './working-copy-damage';

describe('WorkingCopyDamage', () => {
  let database: Database;
  let damage: WorkingCopyDamage;
  let published: { userId: number; event: PushEvent; }[];
  let alice: number;
  let handbook: number;

  const recordOf = (id: number) =>
    database.db.select({
      status: repositories.status,
      errorCode: repositories.errorCode,
      errorDetail: repositories.errorDetail,
      errorRequestId: repositories.errorRequestId
    }).from(repositories).where(eq(repositories.id, id)).get();

  beforeEach(() => {
    database = createTestDatabase();
    published = [];
    const events = { publish: (userId: number, event: PushEvent) => published.push({ userId, event }) };
    damage = new WorkingCopyDamage(new InstanceRepositories(database), events as unknown as EventsHub);
    alice = insertUser(database, 'alice@example.com');
    handbook = insertRepository(database, alice, { name: 'handbook' });
  });

  afterEach(() => database.sqlite.close());

  it('records git\'s message as the detail', () => {
    damage.report(alice, handbook, 'fatal: not a git repository (or any of the parent directories): .git\n');

    expect(recordOf(handbook)).toEqual({
      status: 'error',
      errorCode: 'working-copy-missing',
      errorDetail: 'fatal: not a git repository (or any of the parent directories): .git\n',
      errorRequestId: null
    });
  });

  it('publishes repository.status once', () => {
    damage.report(alice, handbook, 'fatal: not a git repository');
    damage.report(alice, handbook, 'fatal: not a git repository');

    expect(published).toEqual([
      {
        userId: alice,
        event: { type: 'repository.status', repositoryId: handbook, status: 'error', error: 'working-copy-missing' }
      }
    ]);
  });

  it('leaves another user\'s repository alone', () => {
    const bob = insertUser(database, 'bob@example.com');

    damage.report(bob, handbook, 'fatal: not a git repository');

    expect(recordOf(handbook)?.status).toBe('ready');
    expect(published).toEqual([]);
  });

  describe('in a job', () => {
    it('reports a working copy that is gone, and ends the job as failed', async () => {
      const outcome = await damage.inJob(
        alice,
        handbook,
        () => Promise.reject(new GitOperationError('working-copy-missing', 'fatal: not a git repository'))
      );

      expect(outcome).toEqual(WORKING_COPY_MISSING_OUTCOME);
      expect(recordOf(handbook)).toMatchObject({ status: 'error', errorDetail: 'fatal: not a git repository' });
    });

    it('other git errors leave the status alone', async () => {
      const timeout = new GitOperationError('timeout', '');

      await expect(damage.inJob(alice, handbook, () => Promise.reject(timeout))).rejects.toBe(timeout);
      await expect(damage.inJob(alice, handbook, () => Promise.resolve('done'))).resolves.toBe('done');

      expect(recordOf(handbook)?.status).toBe('ready');
      expect(published).toEqual([]);
    });
  });
});
