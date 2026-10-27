import { Module } from '@nestjs/common';
import { KnownHostsController } from './known-hosts/known-hosts.controller';
import { KnownHostsService } from './known-hosts/known-hosts.service';
import { CredentialsController } from './saved/credentials.controller';
import { SavedCredentialsService } from './saved/saved-credentials.service';
import { KeyUnlockStore } from './unlocks/key-unlock-store';

/** A user's saved credentials, known hosts and key unlocks (REQ-REPO-001). Needs the global auth guard. */
@Module({
  controllers: [ CredentialsController, KnownHostsController ],
  providers: [ KeyUnlockStore, SavedCredentialsService, KnownHostsService ],
  exports: [ KeyUnlockStore, SavedCredentialsService, KnownHostsService ]
})
export class CredentialsModule {}
