import { Module } from '@nestjs/common';
import { KnownHostsController } from './known-hosts/known-hosts.controller';
import { KnownHostsService } from './known-hosts/known-hosts.service';
import { CredentialsController } from './saved/credentials.controller';
import { SavedCredentialsService } from './saved/saved-credentials.service';
import { JobKeys } from './unlocks/job-keys';
import { KeyUnlockStore } from './unlocks/key-unlock-store';
import { UnlockAttempts } from './unlocks/unlock-attempts';

/**
 * A user's saved credentials, known hosts, key unlocks with their limit on
 * wrong passphrases, and the keys held for jobs (REQ-REPO-001, RC-18, RC-19). Needs the global auth guard.
 */
@Module({
  controllers: [ CredentialsController, KnownHostsController ],
  providers: [ KeyUnlockStore, UnlockAttempts, JobKeys, SavedCredentialsService, KnownHostsService ],
  exports: [ KeyUnlockStore, JobKeys, SavedCredentialsService, KnownHostsService ]
})
export class CredentialsModule {}
