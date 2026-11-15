import { RemoteProblemsSource } from '@front-burner/server-feature-repositories';
import { Injectable } from '@nestjs/common';
import { SyncStateStore } from './sync-state.store';

/**
 * Gives the repositories feature the stored problems of the operations with
 * the remote, for RM-8's warnings, which it cannot read from here without
 * depending on this feature _(plan 108's call)_.
 */
@Injectable()
export class RemoteProblemsProvider {
  constructor(source: RemoteProblemsSource, syncState: SyncStateStore) {
    source.provide(repositoryIds => syncState.remoteProblemsOf(repositoryIds));
  }
}
