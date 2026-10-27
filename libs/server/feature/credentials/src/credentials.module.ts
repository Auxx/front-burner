import { Module } from '@nestjs/common';
import { KeyUnlockStore } from './unlocks/key-unlock-store';

/** A user's saved credentials, known hosts and key unlocks (REQ-REPO-001). Needs the global auth guard. */
@Module({
  providers: [ KeyUnlockStore ],
  exports: [ KeyUnlockStore ]
})
export class CredentialsModule {}
