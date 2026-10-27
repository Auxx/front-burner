import { Module } from '@nestjs/common';
import { KnownHostsService } from './known-hosts/known-hosts.service';
import { SavedCredentialsService } from './saved/saved-credentials.service';
import { KeyUnlockStore } from './unlocks/key-unlock-store';

/** A user's saved credentials, known hosts and key unlocks (REQ-REPO-001). Needs the global auth guard. */
@Module({
  providers: [ KeyUnlockStore, SavedCredentialsService, KnownHostsService ],
  exports: [ KeyUnlockStore, SavedCredentialsService, KnownHostsService ]
})
export class CredentialsModule {}
