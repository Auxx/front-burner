import { EventsHub } from '@front-burner/server-core-events';
import { GitEngine, GitOperationError, NetworkLock } from '@front-burner/server-core-git';
import { KnownHostsService } from '@front-burner/server-feature-credentials';
import { OpenableRepository } from '@front-burner/server-feature-files';
import type { GitJobFailed } from '@front-burner/shared-contracts';
import { Injectable, Logger } from '@nestjs/common';
import { JobCredentials } from '../jobs/job-credentials.service';
import { networkFailure } from '../jobs/network-failure';
import { SyncStateStore } from '../state/sync-state.store';

/** The job a fetch runs for: its ID names the key copy it may use (RC-19). */
export interface FetchStepJob {
  id: number;
  userId: number;
  repositoryId: number;
}

export type FetchStepResult = { ok: true; moved: boolean; } | { ok: false; failure: GitJobFailed; };

/**
 * One fetch for a job (GA-33): the fetch job's, and a pull's and a background
 * fetch's first step. It remembers why the fetch failed, or that it did not, in
 * `sync_state`, and tells clients only when something changed, so that an idle
 * tab does not read the status after every background fetch _(plan 70's call)_.
 */
@Injectable()
export class FetchStep {
  private readonly logger = new Logger(FetchStep.name);

  constructor(
    private readonly engine: GitEngine,
    private readonly networkLock: NetworkLock,
    private readonly repositories: OpenableRepository,
    private readonly credentials: JobCredentials,
    private readonly knownHosts: KnownHostsService,
    private readonly syncState: SyncStateStore,
    private readonly events: EventsHub
  ) {}

  /**
   * Fetches the repository for the job, then stores the failure's code and
   * params, or clears the stored one on success. A locked key is returned but
   * never stored, as it is locked per session (RC-20) and the stored problem is
   * per repository. Publishes `git.changed` when a remote branch moved, or the
   * stored problem changed.
   *
   * @throws what `OpenableRepository.open` throws, and what is not git's refusal.
   */
  async run(job: FetchStepJob): Promise<FetchStepResult> {
    const { userId, repositoryId } = job;
    // The network step only, under the network lock, so that saves never wait behind the remote (A-5.3).
    const result = await this.networkLock.run(repositoryId, async (): Promise<FetchStepResult> => {
      const { row, root } = this.repositories.open(userId, repositoryId);
      const resolved = this.credentials.resolve(job.id, userId, row);
      if ('failure' in resolved) {
        return { ok: false, failure: resolved.failure };
      }
      try {
        const { moved } = await this.engine.fetch(root, {
          remoteUrl: row.remoteUrl,
          credentials: resolved.credentials,
          knownHosts: this.knownHosts.linesFor(userId)
        });
        return { ok: true, moved };
      } catch (error) {
        if (!(error instanceof GitOperationError)) {
          throw error;
        }
        // git's own lines, without credentials (NF-10.5); only the code and params are kept.
        this.logger.warn(`Fetch of repository ${repositoryId} failed with ${error.code}: ${error.detail.trim()}`);
        return { ok: false, failure: networkFailure(error, row.credentialId !== null) };
      }
    });
    const failure = 'failure' in result ? result.failure : undefined;
    if (failure?.code === 'key-locked') {
      return result;
    }
    const problem = failure === undefined ? null : { code: failure.code, params: failure.params };
    const problemChanged = this.syncState.setFetchProblem(repositoryId, problem);
    if (('moved' in result && result.moved) || problemChanged) {
      this.events.publish(userId, { type: 'git.changed', repositoryId });
    }
    return result;
  }
}
