import { DATABASE, Database, instanceState, systemSettings, users } from '@front-burner/server-core-database';
import type { PasswordSetupRequest } from '@front-burner/shared-contracts';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { PasswordHasher } from '../passwords/password-hasher';

/** Completes administrator onboarding (AO-6, AO-19). */
@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly hasher: PasswordHasher
  ) {}

  /**
   * Creates the first administrator and closes onboarding in one transaction.
   * Of two concurrent calls, the one that comes second finds onboarding closed.
   * A pending OIDC setup from the onboarding page is discarded with it (AO-16);
   * `OnboardingGuard` already refuses when OIDC comes from the environment.
   *
   * @throws NotFoundException when onboarding is `completed`.
   */
  async setUpPassword(request: PasswordSetupRequest): Promise<void> {
    // Hashing is slow and asynchronous, so it happens before the transaction.
    const passwordHash = await this.hasher.hash(request.password);
    this.database.db.transaction(tx => {
      const closed = tx
        .update(instanceState)
        .set({ onboardingState: 'completed', pendingAdminEmail: null })
        .where(and(eq(instanceState.id, 1), inArray(instanceState.onboardingState, [ 'required', 'oidc-pending' ])))
        .run();
      if (closed.changes !== 1) {
        throw new NotFoundException();
      }
      tx.update(systemSettings).set({
        oidcIssuer: null,
        oidcClientId: null,
        oidcClientSecret: null,
        oidcScopes: null,
        oidcRequireVerifiedEmail: null
      }).where(eq(systemSettings.id, 1)).run();
      tx.insert(users).values({
        email: request.email,
        displayName: request.displayName,
        role: 'administrator',
        loginMethod: 'password',
        passwordHash,
        createdAt: new Date()
      }).run();
    });
    this.logger.log('Administrator onboarding completed');
  }
}
