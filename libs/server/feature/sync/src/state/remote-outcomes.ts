import { EventsHub } from '@front-burner/server-core-events';
import { RepositoryCredentialsChanges } from '@front-burner/server-feature-repositories';
import type { GitProblemState } from '@front-burner/shared-contracts';
import { Injectable } from '@nestjs/common';
import { RemoteOperation, SyncStateStore } from './sync-state.store';

/** Taken before an operation reads its credentials, and given back with its outcome. */
export interface RemoteAttempt {
  readonly userId: number;
  readonly repositoryId: number;
  readonly kind: RemoteOperation;
  readonly generation: number;
}

/**
 * Records how an operation with the remote ended, for RM-8's warnings, and
 * tells the owner's clients with `repository.warning` when a stored warning
 * changed (A-3.11). An operation keeps the credentials it read (RC-19), so
 * when the repository's credentials changed while it ran, its outcome says
 * nothing about the ones now in use and is not recorded: else a push with the
 * old credentials would bring back "Can't push with these credentials" that
 * the change just cleared. Callers record while they still hold the network
 * lock, so that outcomes are stored in the order the operations ran.
 */
@Injectable()
export class RemoteOutcomes {
  constructor(
    private readonly syncState: SyncStateStore,
    private readonly credentialsChanges: RepositoryCredentialsChanges,
    private readonly events: EventsHub
  ) {}

  /** Before the operation reads its credentials. */
  begin(userId: number, repositoryId: number, kind: RemoteOperation): RemoteAttempt {
    return { userId, repositoryId, kind, generation: this.credentialsChanges.generation(repositoryId) };
  }

  /**
   * The operation ended: `null` when it succeeded, else git's refusal. True when
   * a stored warning changed; false also when the outcome was not recorded.
   */
  end(attempt: RemoteAttempt, problem: GitProblemState | null): boolean {
    const { userId, repositoryId, kind, generation } = attempt;
    if (this.credentialsChanges.generation(repositoryId) !== generation) {
      return false;
    }
    const changed = problem === null
      ? this.syncState.remoteSucceeded(repositoryId, kind)
      : this.syncState.remoteFailed(repositoryId, kind, problem);
    if (changed) {
      this.events.publish(userId, { type: 'repository.warning', repositoryId });
    }
    return changed;
  }
}
