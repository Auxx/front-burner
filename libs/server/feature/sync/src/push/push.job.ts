import type { Job } from '@front-burner/server-core-database';
import { EventsHub } from '@front-burner/server-core-events';
import { GitCredentials, GitEngine, GitOperationError, NetworkLock } from '@front-burner/server-core-git';
import { JobRunner, RunningJob } from '@front-burner/server-core-jobs';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { JobKeys, KnownHostsService, SavedCredentialsService } from '@front-burner/server-feature-credentials';
import { OpenableRepository } from '@front-burner/server-feature-files';
import { RepositoryQueries } from '@front-burner/server-feature-repositories';
import type { GitJobOutcome } from '@front-burner/shared-contracts';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

export const PUSH_JOB_TYPE = 'sync.push';

/** Never a secret (A-6.3). */
export interface PushJobPayload {
  /** The branch that was current when the user chose **Push** (GA-29). */
  branch: string;
}

/** The dedupe key of a repository's push, so that a second request gets the same job. */
export const pushDedupeKey = (repositoryId: number) => `push:${repositoryId}`;

/**
 * The API's code for a push that git refused or could not do (GA-30, GA-31,
 * RC-4, RC-5, CA-15). Text for each is under `errors.<code>`.
 */
function failureCode(error: GitOperationError, hasCredentials: boolean): string {
  switch (error.code) {
    case 'auth-failed':
      return hasCredentials ? 'credentials-refused' : 'no-credentials';
    case 'timeout':
      return 'remote-timeout';
    case 'push-non-fast-forward':
    case 'push-not-allowed':
    case 'push-protected-branch':
    case 'push-unsigned':
    case 'push-rejected':
    case 'host-unreachable':
    case 'tls-untrusted':
    case 'repository-not-found':
    case 'host-key-changed':
    case 'host-key-unknown':
      return error.code;
    default:
      return 'remote-failed';
  }
}

const stringParams = (params: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(Object.entries(params).map(([ key, value ]) => [ key, String(value) ]));

/**
 * The push job (GA-3, GA-29 to GA-31). A push that git refused is a job that
 * finished: its result is `{ kind: 'failed', code, params }`, since
 * `jobs.error_code` has no room for the params and nothing went wrong in the
 * runner _(plan 57's call)_. The job reads its credentials when it runs; a
 * protected key only from the copy held since it was queued (RC-19).
 */
@Injectable()
export class PushJob implements OnModuleInit {
  private readonly logger = new Logger(PushJob.name);

  constructor(
    private readonly runner: JobRunner,
    private readonly engine: GitEngine,
    private readonly networkLock: NetworkLock,
    private readonly repositories: OpenableRepository,
    private readonly queries: RepositoryQueries,
    private readonly saved: SavedCredentialsService,
    private readonly knownHosts: KnownHostsService,
    private readonly jobKeys: JobKeys,
    private readonly events: EventsHub
  ) {}

  onModuleInit(): void {
    this.runner.register<PushJobPayload, GitJobOutcome>({
      type: PUSH_JOB_TYPE,
      pool: 'fetch',
      // A push is not repeated on its own after a restart: the user decides (GA-3).
      onInterrupted: 'fail',
      maxAttempts: 1,
      handler: job => this.push(job),
      onFinished: job => this.finished(job)
    });
  }

  private async push(job: RunningJob<PushJobPayload>): Promise<GitJobOutcome> {
    const { userId, repositoryId } = job;
    if (userId === null || repositoryId === null) {
      throw new Error('A push job needs its user and repository');
    }
    // Network steps take the network lock only, so saves never wait behind the remote (A-5.3).
    return this.networkLock.run(repositoryId, async () => {
      const root = this.repositories.root(userId, repositoryId);
      const row = this.queries.find(userId, repositoryId);
      if (row === undefined) {
        throw new ApiErrorException(404, 'not-found');
      }
      const { branch } = job.payload;
      let credentials: GitCredentials;
      try {
        credentials = row.credentialId === null
          ? { kind: 'none' }
          : this.saved.resolveForJob(userId, row.credentialId, this.jobKeys.take(job.id));
      } catch (error) {
        if (error instanceof ApiErrorException && error.getStatus() === 409) {
          // `key-locked` or `credentials-missing`, with what the user needs to fix it (RC-4).
          return { kind: 'failed', code: error.code, params: stringParams(error.params) };
        }
        throw error;
      }
      try {
        const result = await this.engine.push(root, {
          remoteUrl: row.remoteUrl,
          credentials,
          knownHosts: this.knownHosts.linesFor(userId),
          branch,
          singleBranch: row.cloneMode === 'single-branch'
        });
        return { kind: 'pushed', commits: result.commits, upstream: result.upstream };
      } catch (error) {
        if (!(error instanceof GitOperationError)) {
          throw error;
        }
        // git's own lines, without credentials (NF-10.5); the user gets the code and the remote's lines.
        this.logger.warn(`Push of repository ${repositoryId} failed with ${error.code}: ${error.detail.trim()}`);
        return {
          kind: 'failed',
          code: failureCode(error, row.credentialId !== null),
          params: { branch, ...error.params }
        };
      }
    });
  }

  /** Every end, the job's key copy goes (RC-19), and clients read the new state (A-3.11). */
  private finished(job: Job): void {
    this.jobKeys.release(job.id);
    if (job.userId !== null && job.repositoryId !== null) {
      this.events.publish(job.userId, { type: 'git.changed', repositoryId: job.repositoryId });
    }
  }
}
