import { EventsHub } from '@front-burner/server-core-events';
import type { UnlockedKey } from '@front-burner/server-core-git';
import { JobRunner } from '@front-burner/server-core-jobs';
import { JobKeys, SavedCredentialsService } from '@front-burner/server-feature-credentials';
import { RepositoryQueries } from '@front-burner/server-feature-repositories';
import { BeforeApplicationShutdown, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { BACKGROUND_FETCH_JOB_TYPE, backgroundFetchDedupeKey, FetchJobPayload } from './fetch.job';

/** How often each viewed repository is fetched in the background (A-6.7). A constant, not a setting. */
export const FETCH_INTERVAL_MS = 120_000;

/** How often the scheduler looks at what the push channel streams view. */
export const VIEWERS_CHECK_MS = 5_000;

/** The least time between two fetches of a repository because a file was opened (GA-33). */
export const FILE_OPENED_MIN_MS = 30_000;

/**
 * Background fetches (A-6, GA-33): every 2 minutes for each repository a push
 * channel stream views (A-3.12), the first one at once, which also tells a
 * user coming back what changed. It looks at `EventsHub.viewers()` every 5
 * seconds, so a tab that goes away stops causing fetches by itself. Opening a
 * file also fetches, at most once every 30 seconds per repository, whichever
 * tab or session opens it; that fetch leaves the 2-minute schedule as it is.
 */
@Injectable()
export class FetchScheduler implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(FetchScheduler.name);
  /** `<userId>:<repositoryId>` → when its last background fetch was queued, for viewed repositories only. */
  private readonly lastQueued = new Map<string, number>();
  /** Repository ID → when a file opened in it last queued a fetch, for the last 30 seconds only. */
  private readonly lastFileOpened = new Map<number, number>();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly events: EventsHub,
    private readonly repositories: RepositoryQueries,
    private readonly runner: JobRunner,
    private readonly saved: SavedCredentialsService,
    private readonly jobKeys: JobKeys
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => this.check(), VIEWERS_CHECK_MS);
    this.timer.unref();
  }

  beforeApplicationShutdown(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /**
   * Queues a background fetch of the user's ready repository, or finds the one
   * already waiting or running, and returns whether it did. A protected key
   * must be unlocked in one of `sessionIds`, the sessions viewing the
   * repository; the job holds a copy of that unlock (RC-19) without keeping it
   * alive (A-5.5, D-2.7). The user's other sessions are never used. Another
   * user's repository, or one that is not ready, queues nothing.
   *
   * @throws NotFoundException when the repository's credential is not the user's (AR-56).
   */
  enqueueIfUnlocked(userId: number, repositoryId: number, sessionIds: string[]): boolean {
    const row = this.repositories.find(userId, repositoryId);
    if (row === undefined || row.status !== 'ready') {
      return false;
    }
    const { credentialId } = row;
    let heldKey: UnlockedKey | undefined;
    if (credentialId !== null) {
      const usable = sessionIds.map(sessionId => this.saved.keyForBackgroundJob(userId, sessionId, credentialId))
        .find(found => found.usable);
      if (usable === undefined) {
        // Skipped: the key-locked banner already says why, per session (RC-15, RC-20).
        return false;
      }
      heldKey = usable.key;
    }
    const payload: FetchJobPayload = {};
    const jobId = this.runner.enqueue({
      type: BACKGROUND_FETCH_JOB_TYPE,
      userId,
      repositoryId,
      payload,
      dedupeKey: backgroundFetchDedupeKey(repositoryId)
    });
    // Synchronously after queueing, before the runner's loop can start the job.
    if (heldKey !== undefined && credentialId !== null) {
      this.jobKeys.hold(jobId, credentialId, heldKey);
    }
    return true;
  }

  /**
   * A file of the user's repository was opened in `sessionId` (GA-33): fetches
   * unless a file opened in it queued one less than 30 seconds ago. The key's
   * unlock is that session's, or that of one of the user's sessions viewing the
   * repository. Nobody waits for this fetch, so a skipped one says nothing
   * (GA-35) and does not count towards the 30 seconds, nor does a problem,
   * which is only logged.
   */
  fileOpened(userId: number, sessionId: string, repositoryId: number): void {
    const now = Date.now();
    for (const [ id, queued ] of this.lastFileOpened) {
      if (now - queued >= FILE_OPENED_MIN_MS) {
        this.lastFileOpened.delete(id);
      }
    }
    if (this.lastFileOpened.has(repositoryId)) {
      return;
    }
    const viewing = this.events.viewers()
      .filter(viewer => viewer.userId === userId && viewer.repositoryId === repositoryId)
      .map(viewer => viewer.sessionId);
    try {
      if (this.enqueueIfUnlocked(userId, repositoryId, [ ...new Set([ sessionId, ...viewing ]) ])) {
        this.lastFileOpened.set(repositoryId, now);
      }
    } catch (error) {
      this.logger.warn(`Fetch of repository ${repositoryId} for an opened file not queued: ${String(error)}`);
    }
  }

  /**
   * Queues what is due. A repository no stream views is forgotten, so that the
   * next view fetches at once. A fetch that was skipped records nothing, so
   * that the next check tries again, as soon as the key is unlocked.
   */
  private check(): void {
    const viewed = new Map<string, { userId: number; repositoryId: number; sessionIds: Set<string>; }>();
    for (const { userId, sessionId, repositoryId } of this.events.viewers()) {
      const key = `${userId}:${repositoryId}`;
      const entry = viewed.get(key) ?? { userId, repositoryId, sessionIds: new Set<string>() };
      entry.sessionIds.add(sessionId);
      viewed.set(key, entry);
    }
    for (const key of [ ...this.lastQueued.keys() ]) {
      if (!viewed.has(key)) {
        this.lastQueued.delete(key);
      }
    }
    const now = Date.now();
    for (const [ key, { userId, repositoryId, sessionIds } ] of viewed) {
      const last = this.lastQueued.get(key);
      if (last !== undefined && now - last < FETCH_INTERVAL_MS) {
        continue;
      }
      try {
        if (this.enqueueIfUnlocked(userId, repositoryId, [ ...sessionIds ])) {
          this.lastQueued.set(key, now);
        }
      } catch (error) {
        // One repository's problem must not stop the others' fetches.
        this.logger.warn(`Background fetch of repository ${repositoryId} not queued: ${String(error)}`);
      }
    }
  }
}
