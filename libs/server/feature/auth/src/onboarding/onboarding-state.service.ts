import { CONFIG, Config } from '@front-burner/server-core-config';
import { DATABASE, Database, instanceState, users } from '@front-burner/server-core-database';
import type { OnboardingState, OnboardingStatus } from '@front-burner/shared-contracts';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';

const ROW = 1;

/** The onboarding state of the instance (AO-1), stored in `instance_state`. */
@Injectable()
export class OnboardingStateService implements OnModuleInit {
  private readonly logger = new Logger(OnboardingStateService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CONFIG) private readonly config: Config
  ) {}

  /** Startup step 5 (A-1.11): works out the state before the HTTP server starts. */
  onModuleInit(): void {
    const { db } = this.database;
    const state = db.transaction(tx => {
      const hasUser = tx.select({ id: users.id }).from(users).limit(1).get() !== undefined;
      const row = tx.select().from(instanceState).where(eq(instanceState.id, ROW)).get();
      const next: OnboardingState = hasUser ? 'completed' : (row?.onboardingState ?? 'required');
      if (!row) {
        tx.insert(instanceState).values({ id: ROW, onboardingState: next }).run();
      } else if (row.onboardingState !== next) {
        tx.update(instanceState).set({ onboardingState: next }).where(eq(instanceState.id, ROW)).run();
      }
      return next;
    });
    this.logger.log(`Administrator onboarding state: ${state}`);
  }

  /** Read on every call, so that it is always current (A-4.2: well under a millisecond). */
  current(): OnboardingState {
    const row = this.database.db.select().from(instanceState).where(eq(instanceState.id, ROW)).get();
    return row?.onboardingState ?? 'required';
  }

  status(): OnboardingStatus {
    return {
      state: this.current(),
      oidcFromEnvironment: false,
      setupTokenConfigured: this.config.setupToken !== undefined
    };
  }
}
