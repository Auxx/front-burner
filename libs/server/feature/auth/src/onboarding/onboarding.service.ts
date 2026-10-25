import { DATABASE, Database, instanceState, users } from '@front-burner/server-core-database';
import type { PasswordSetupRequest } from '@front-burner/shared-contracts';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
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
   *
   * @throws NotFoundException when onboarding is no longer `required`.
   */
  async setUpPassword(request: PasswordSetupRequest): Promise<void> {
    // Hashing is slow and asynchronous, so it happens before the transaction.
    const passwordHash = await this.hasher.hash(request.password);
    this.database.db.transaction(tx => {
      const closed = tx
        .update(instanceState)
        .set({ onboardingState: 'completed' })
        .where(and(eq(instanceState.id, 1), eq(instanceState.onboardingState, 'required')))
        .run();
      if (closed.changes !== 1) {
        throw new NotFoundException();
      }
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
    this.logger.debug(`Administrator created: ${request.email}`);
  }
}
