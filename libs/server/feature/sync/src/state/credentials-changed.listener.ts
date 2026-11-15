import { EventsHub } from '@front-burner/server-core-events';
import { RepositoryCredentialsChanges } from '@front-burner/server-feature-repositories';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Subscription } from 'rxjs';
import { SyncStateStore } from './sync-state.store';

/**
 * Forgets "Can't push with these credentials" when a repository's credentials
 * change, as RM-8 says, and tells the owner's clients with
 * `repository.warning`; the other warnings wait for an operation with the
 * remote to succeed.
 */
@Injectable()
export class CredentialsChangedListener implements OnModuleDestroy {
  private readonly logger = new Logger(CredentialsChangedListener.name);
  readonly #subscription: Subscription;

  constructor(changes: RepositoryCredentialsChanges, syncState: SyncStateStore, events: EventsHub) {
    this.#subscription = changes.changed.subscribe(({ userId, repositoryId }) => {
      // RxJS throws a subscriber's error again outside any caller, where it would stop the process.
      try {
        if (syncState.credentialsChanged(repositoryId)) {
          events.publish(userId, { type: 'repository.warning', repositoryId });
        }
      } catch (error) {
        this.logger.error(`Could not forget the push problem of repository ${repositoryId}: ${String(error)}`);
      }
    });
  }

  onModuleDestroy(): void {
    this.#subscription.unsubscribe();
  }
}
