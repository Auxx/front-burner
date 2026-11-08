import type { Job } from '@front-burner/server-core-database';
import { EventsHub } from '@front-burner/server-core-events';
import { GitEngine, GitMerge, GitOperationError, MergeResult } from '@front-burner/server-core-git';
import { JobRunner, RunningJob } from '@front-burner/server-core-jobs';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { JobKeys } from '@front-burner/server-feature-credentials';
import { OpenableRepository, WorkingTreeGuard } from '@front-burner/server-feature-files';
import { CommitAuthors } from '@front-burner/server-feature-preferences';
import type { GitJobFailed, GitJobOutcome } from '@front-burner/shared-contracts';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { FetchStep } from '../fetch/fetch-step';
import { SyncStateStore } from '../state/sync-state.store';
import { sameNameRemote } from './same-name-remote';

export const PULL_JOB_TYPE = 'sync.pull';

/** Never a secret (A-6.3). */
export interface PullJobPayload {
  /** The branch that was current when the user chose **Pull**: no other is merged into. */
  branch: string;
}

/**
 * The dedupe key of a branch's pull, so that a second request gets the same
 * job, and a pull of another branch after a switch gets its own.
 */
export const pullDedupeKey = (repositoryId: number, branch: string) => `pull:${repositoryId}:${branch}`;

const failed = (code: string, params: Record<string, string> = {}): GitJobFailed => ({ kind: 'failed', code, params });

/**
 * The pull job (GA-25 to GA-28): `FetchStep` under the network lock, then the
 * merge inside the working-tree lock, where the request's checks are made
 * again, since a save or a branch switch can arrive during the fetch (A-5.3).
 * What git refused, and every check that fails, is a `failed` outcome with
 * nothing merged (plan 57's call).
 *
 * Just before a merge that changes something, the commit is recorded in
 * `sync_state` and under `PRE_MERGE_REF` (A-4.5a, GA-27), with the earlier
 * record kept until the merge ends, so that a pull that fails gives back what
 * **Undo merge** of an earlier merge needs (GC-25).
 */
@Injectable()
export class PullJob implements OnModuleInit {
  private readonly logger = new Logger(PullJob.name);

  constructor(
    private readonly runner: JobRunner,
    private readonly fetchStep: FetchStep,
    private readonly repositories: OpenableRepository,
    private readonly engine: GitEngine,
    private readonly merges: GitMerge,
    private readonly guard: WorkingTreeGuard,
    private readonly commitAuthors: CommitAuthors,
    private readonly syncState: SyncStateStore,
    private readonly jobKeys: JobKeys,
    private readonly events: EventsHub
  ) {}

  onModuleInit(): void {
    this.runner.register<PullJobPayload, GitJobOutcome>({
      type: PULL_JOB_TYPE,
      pool: 'fetch',
      // A pull is not repeated on its own after a restart: the user decides (GA-3).
      onInterrupted: 'fail',
      maxAttempts: 1,
      handler: job => this.pull(job),
      onFinished: job => this.finished(job)
    });
  }

  private async pull(job: RunningJob<PullJobPayload>): Promise<GitJobOutcome> {
    const { id, userId, repositoryId } = job;
    if (userId === null || repositoryId === null) {
      throw new Error('A pull job needs its user and repository');
    }
    const fetched = await this.fetchStep.run({ id, userId, repositoryId });
    if ('failure' in fetched) {
      return fetched.failure;
    }
    const { root } = this.repositories.open(userId, repositoryId);
    let outcome: GitJobOutcome;
    try {
      outcome = await this.guard.change(
        repositoryId,
        root,
        () => this.merge(userId, repositoryId, root, job.payload.branch)
      );
    } catch (error) {
      if (error instanceof ApiErrorException && error.code === 'merge-in-progress') {
        return failed('merge-in-progress');
      }
      throw error;
    }
    if (outcome.kind === 'pulled' && outcome.result !== 'up-to-date') {
      // Which files changed is not worked out: clients reread what they show (FB-41).
      this.events.publish(userId, { type: 'files.changed', repositoryId, folders: 'all' });
    }
    return outcome;
  }

  /** Inside the working-tree lock, with no merge in progress. */
  private async merge(userId: number, repositoryId: number, root: string, branch: string): Promise<GitJobOutcome> {
    const status = await this.engine.status(root);
    if (status.branch !== branch) {
      return failed('branch-changed', { branch });
    }
    // The fetch may have removed the upstream, or the branch's remote branch.
    const adopting = await sameNameRemote(this.merges, root, status);
    const upstream = adopting ? `origin/${branch}` : status.upstream;
    // Only `origin`'s branches are pulled; Front Burner sets no other upstream.
    if (upstream === null || !upstream.startsWith('origin/') || status.noCommits || status.upstreamGone) {
      return failed('no-upstream');
    }
    // Ignored files are not changes (GA-11), so a repository with build output can pull.
    if (status.changes.length > 0) {
      return failed('uncommitted-changes');
    }
    const { author, confirmed } = this.commitAuthors.forRepository(userId, repositoryId);
    // Asked only after the fetch, which says whether a merge commit is needed (CA-14).
    if (!confirmed && await this.merges.needsMergeCommit(root, upstream)) {
      return failed('commit-author-not-confirmed');
    }
    if (adopting) {
      // The upstream the user asked to pull from; it stays whatever the merge does.
      await this.merges.adoptUpstream(root, branch);
    }
    if (await this.merges.isUpToDate(root, upstream)) {
      // No record is touched, so that **Undo merge** of an earlier merge stays.
      return { kind: 'pulled', result: 'up-to-date', commits: 0, upstream };
    }
    const recorded = await this.merges.record(root);
    this.syncState.startMerge(repositoryId, recorded);
    let result: MergeResult;
    try {
      result = await this.merges.merge(root, { branch, upstream, author });
    } catch (error) {
      return this.mergeFailed(repositoryId, root, recorded, error);
    }
    switch (result.kind) {
      case 'up-to-date':
        // A fetch moved the upstream back meanwhile: nothing changed.
        await this.restoreEarlier(repositoryId, root);
        return { kind: 'pulled', result: 'up-to-date', commits: 0, upstream };
      case 'fast-forward':
        // The branch has moved past any earlier merge.
        this.syncState.forgetRecord(repositoryId);
        await this.merges.forgetRecord(root);
        break;
      case 'merged':
        this.syncState.mergeCommitted(repositoryId, result.oid);
        break;
      case 'conflicted':
        // The record stays until the merge ends (A-4.5a).
        this.syncState.mergeStopped(repositoryId);
        break;
    }
    return { kind: 'pulled', result: result.kind, commits: result.commits, upstream };
  }

  /**
   * A merge that git refused before it started changed nothing; any other may
   * have stopped partway, and is undone first (GA-43). Either way the earlier
   * record comes back. When the undo itself fails, the record stays as it is,
   * marked as being applied, for recovery (plan 78).
   */
  private async mergeFailed(
    repositoryId: number,
    root: string,
    recorded: string,
    error: unknown
  ): Promise<GitJobOutcome> {
    if (error instanceof GitOperationError && error.code === 'merge-blocked') {
      await this.restoreEarlier(repositoryId, root);
      return failed('merge-blocked', error.params);
    }
    this.logger.warn(`Merge of repository ${repositoryId} failed; undoing it: ${String(error)}`);
    await this.merges.undoCutShort(root, recorded);
    await this.restoreEarlier(repositoryId, root);
    if (error instanceof GitOperationError && error.code === 'timeout') {
      return failed('git-timeout');
    }
    throw error;
  }

  /** Puts the earlier record back in `sync_state` and under `PRE_MERGE_REF`, or drops both. */
  private async restoreEarlier(repositoryId: number, root: string): Promise<void> {
    const earlier = this.syncState.restoreEarlier(repositoryId);
    if (earlier === null) {
      await this.merges.forgetRecord(root);
    } else {
      await this.merges.keepRecord(root, earlier);
    }
  }

  /** Every end, the job's key copy goes (RC-19), and clients read the new state (A-3.11). */
  private finished(job: Job): void {
    this.jobKeys.release(job.id);
    if (job.userId !== null && job.repositoryId !== null) {
      this.events.publish(job.userId, { type: 'git.changed', repositoryId: job.repositoryId });
    }
  }
}
