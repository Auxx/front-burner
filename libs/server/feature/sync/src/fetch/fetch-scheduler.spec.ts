import type { Config } from '@front-burner/server-core-config';
import { SecretBox } from '@front-burner/server-core-crypto';
import { Database, repositories } from '@front-burner/server-core-database';
import { EventsHub } from '@front-burner/server-core-events';
import { FIXTURE_PASSPHRASE, sshKeyFixture } from '@front-burner/server-core-git/testing';
import type { EnqueueRequest, JobRunner } from '@front-burner/server-core-jobs';
import { SessionLifecycle } from '@front-burner/server-core-security';
import {
  JobKeys,
  KeyUnlockStore,
  SavedCredentialsService,
  UnlockAttempts
} from '@front-burner/server-feature-credentials';
import { RepositoryQueries } from '@front-burner/server-feature-repositories';
import { eq } from 'drizzle-orm';
import { insertRepository, insertUser } from '../testing/fixtures';
import { createTestDatabase } from '../testing/test-database';
import { FETCH_INTERVAL_MS, FetchScheduler, VIEWERS_CHECK_MS } from './fetch-scheduler';
import { BACKGROUND_FETCH_JOB_TYPE, backgroundFetchDedupeKey } from './fetch.job';

const box = new SecretBox('fetch-scheduler-spec-key-0123456789abcdef');
const IDLE_MS = 600_000;

describe('FetchScheduler', () => {
  let database: Database;
  let hub: EventsHub;
  let unlocks: KeyUnlockStore;
  let saved: SavedCredentialsService;
  let jobKeys: JobKeys;
  let enqueued: EnqueueRequest[];
  let scheduler: FetchScheduler;
  let alice: number;
  let bob: number;
  let handbook: number;

  // A job's ID is its position in `enqueued`.
  const runner = { enqueue: (request: EnqueueRequest) => enqueued.push(request) } as unknown as JobRunner;
  const view = (userId: number, sessionId: string, repositoryId: number) =>
    hub.open({ userId, sessionId, repositoryId, send: () => undefined, close: () => undefined });
  const fetches = () => enqueued.filter(request => request.type === BACKGROUND_FETCH_JOB_TYPE);
  const tick = (times = 1) => vi.advanceTimersByTime(VIEWERS_CHECK_MS * times);
  const protectedKey = () =>
    database.db.transaction(tx =>
      saved.createPastedKey(tx, alice, {
        name: 'Laptop',
        privateKey: sshKeyFixture('ed25519-passphrase'),
        passphrase: FIXTURE_PASSPHRASE
      })
    );
  const useCredential = (repositoryId: number, credentialId: number) =>
    database.db.update(repositories).set({ credentialId }).where(eq(repositories.id, repositoryId)).run();

  beforeEach(() => {
    vi.useFakeTimers();
    database = createTestDatabase();
    hub = new EventsHub();
    unlocks = new KeyUnlockStore({ keyUnlockIdleMs: IDLE_MS } as Config, new SessionLifecycle(), hub);
    saved = new SavedCredentialsService(database, box, unlocks, new UnlockAttempts());
    jobKeys = new JobKeys();
    enqueued = [];
    alice = insertUser(database, 'alice@x.io');
    bob = insertUser(database, 'bob@x.io');
    handbook = insertRepository(database, alice, { name: 'Handbook' });
    scheduler = new FetchScheduler(hub, new RepositoryQueries(database), runner, saved, jobKeys);
    scheduler.onApplicationBootstrap();
  });

  afterEach(() => {
    scheduler.beforeApplicationShutdown();
    unlocks.onModuleDestroy();
    database.sqlite.close();
    vi.useRealTimers();
  });

  it('fetches at once when a repository is first viewed', () => {
    view(alice, 's1', handbook);

    tick();

    expect(fetches()).toEqual([
      {
        type: BACKGROUND_FETCH_JOB_TYPE,
        userId: alice,
        repositoryId: handbook,
        payload: {},
        dedupeKey: backgroundFetchDedupeKey(handbook)
      }
    ]);
    expect(backgroundFetchDedupeKey(handbook)).toBe(`fetch:${handbook}`);
  });

  it('fetches again after 2 minutes', () => {
    view(alice, 's1', handbook);
    tick();

    vi.advanceTimersByTime(FETCH_INTERVAL_MS - VIEWERS_CHECK_MS);
    expect(fetches()).toHaveLength(1);
    tick();

    expect(FETCH_INTERVAL_MS).toBe(120_000);
    expect(fetches()).toHaveLength(2);
  });

  it('stops when no stream views it', () => {
    const close = view(alice, 's1', handbook);
    tick();

    close();
    vi.advanceTimersByTime(FETCH_INTERVAL_MS * 3);

    expect(fetches()).toHaveLength(1);
  });

  it('fetches once for two tabs', () => {
    view(alice, 's1', handbook);
    view(alice, 's1', handbook);
    view(alice, 's2', handbook);

    vi.advanceTimersByTime(FETCH_INTERVAL_MS);

    expect(fetches()).toHaveLength(1);
  });

  it('ignores a repository that is not the user\'s or not ready', () => {
    const cloning = insertRepository(database, alice, { name: 'Cloning', status: 'cloning' });
    view(bob, 'b1', handbook);
    view(alice, 's1', cloning);
    view(alice, 's1', 9999);

    tick(3);

    expect(fetches()).toEqual([]);
  });

  it('does not fetch for a locked key', () => {
    useCredential(handbook, protectedKey());
    view(alice, 's1', handbook);

    tick(3);

    expect(fetches()).toEqual([]);
  });

  it('uses the unlock of a session viewing it, and of no other', () => {
    const key = protectedKey();
    useCredential(handbook, key);
    saved.unlock(alice, 's2', key, FIXTURE_PASSPHRASE);
    view(alice, 's1', handbook);
    tick(3);
    expect(fetches()).toEqual([]);

    view(alice, 's2', handbook);
    tick();

    expect(fetches()).toHaveLength(1);
    expect(jobKeys.take(enqueued.length, key)).toBe(unlocks.get('s2', key, { touch: false }));
  });

  it('does not keep a key unlocked', () => {
    const key = protectedKey();
    useCredential(handbook, key);
    saved.unlock(alice, 's1', key, FIXTURE_PASSPHRASE);
    view(alice, 's1', handbook);

    vi.advanceTimersByTime(IDLE_MS);

    expect(fetches().length).toBeGreaterThan(1);
    expect(unlocks.isUnlocked('s1', key)).toBe(false);
  });

  it('fetches as soon as the key is unlocked', () => {
    const key = protectedKey();
    useCredential(handbook, key);
    view(alice, 's1', handbook);
    tick(3);
    expect(fetches()).toEqual([]);

    saved.unlock(alice, 's1', key, FIXTURE_PASSPHRASE);
    tick();

    expect(fetches()).toHaveLength(1);
    expect(jobKeys.take(enqueued.length, key)).toBe(unlocks.get('s1', key, { touch: false }));
  });

  it('queues only for a session given, and says whether it did', () => {
    const key = protectedKey();
    useCredential(handbook, key);
    saved.unlock(alice, 's2', key, FIXTURE_PASSPHRASE);

    expect(scheduler.enqueueIfUnlocked(alice, handbook, [ 's1' ])).toBe(false);
    expect(scheduler.enqueueIfUnlocked(bob, handbook, [ 's2' ])).toBe(false);
    expect(scheduler.enqueueIfUnlocked(alice, handbook, [ 's1', 's2' ])).toBe(true);
    expect(fetches()).toHaveLength(1);
  });
});
