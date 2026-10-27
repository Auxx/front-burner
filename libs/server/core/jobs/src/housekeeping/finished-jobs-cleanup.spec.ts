import type { Config } from '@front-burner/server-core-config';
import { Database, jobs, JobStatus } from '@front-burner/server-core-database';
import type { EventsHub } from '@front-burner/server-core-events';
import { JobRunner } from '../runner/job-runner';
import { createTestDatabase } from '../testing/test-database';
import { FinishedJobsCleanup } from './finished-jobs-cleanup';

const NOW = new Date('2026-10-27T12:00:00Z');
const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);

describe('FinishedJobsCleanup', () => {
  let database: Database;
  let cleanup: FinishedJobsCleanup;

  const insert = (status: JobStatus, finishedAt: Date | null) =>
    database.db.insert(jobs).values({ type: 'test', status, runAt: daysAgo(30), createdAt: daysAgo(30), finishedAt })
      .returning().get().id;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: [ 'Date' ] });
    vi.setSystemTime(NOW);
    database = createTestDatabase();
    const runner = new JobRunner(
      database,
      { cloneConcurrency: 2 } as Config,
      { publish: vi.fn() } as unknown as EventsHub
    );
    cleanup = new FinishedJobsCleanup(database, runner);
  });

  afterEach(() => {
    database.sqlite.close();
    vi.useRealTimers();
  });

  it('keeps unfinished and recent jobs', () => {
    const kept = [ insert('queued', null), insert('running', null), insert('done', daysAgo(6)) ];
    insert('done', daysAgo(8));
    insert('failed', daysAgo(8));
    insert('cancelled', daysAgo(8));

    expect(cleanup.deleteOld()).toBe(3);

    expect(database.db.select({ id: jobs.id }).from(jobs).orderBy(jobs.id).all().map(({ id }) => id)).toEqual(kept);
  });
});
