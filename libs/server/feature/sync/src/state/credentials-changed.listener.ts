import { RepositoryCredentialsChanges } from '@front-burner/server-feature-repositories';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Subscription } from 'rxjs';
import { SyncStateStore } from './sync-state.store';

/**
 * Forgets "Can't push with these credentials" when a repository's credentials
 * change, as RM-8 says; the other warnings wait for an operation with the
 * remote to succeed.
 */
@Injectable()
export class CredentialsChangedListener implements OnModuleDestroy {
  readonly #subscription: Subscription;

  constructor(changes: RepositoryCredentialsChanges, syncState: SyncStateStore) {
    // The change is told by plan 108's event.
    this.#subscription = changes.changed.subscribe(repositoryId => syncState.credentialsChanged(repositoryId));
  }

  onModuleDestroy(): void {
    this.#subscription.unsubscribe();
  }
}
