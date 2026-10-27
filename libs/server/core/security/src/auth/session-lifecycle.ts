import { Global, Injectable, Module } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

/**
 * Tells other features that a session ended, so that they drop what they hold
 * for it, such as key unlocks (AR-31), without depending on the auth feature
 * (A-7.2).
 */
@Injectable()
export class SessionLifecycle {
  readonly #revoked = new Subject<string>();

  /** The IDs of revoked sessions, from now on. */
  readonly revoked: Observable<string> = this.#revoked.asObservable();

  notifyRevoked(sessionId: string): void {
    this.#revoked.next(sessionId);
  }
}

/** Provides {@link SessionLifecycle} everywhere. */
@Global()
@Module({
  providers: [ SessionLifecycle ],
  exports: [ SessionLifecycle ]
})
export class SessionLifecycleModule {}
