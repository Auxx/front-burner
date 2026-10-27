import { CONFIG, Config } from '@front-burner/server-core-config';
import { DATABASE, Database, instanceState, systemSettings, users } from '@front-burner/server-core-database';
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

  /** Startup step 5 (A-1.11): works out the state before the HTTP server starts (AO-1, AO-33, AO-36). */
  onModuleInit(): void {
    const { db } = this.database;
    const oidc = this.config.oidc;
    const state = db.transaction(tx => {
      const hasUser = tx.select({ id: users.id }).from(users).limit(1).get() !== undefined;
      const row = tx.select().from(instanceState).where(eq(instanceState.id, ROW)).get();
      let next: OnboardingState;
      let pendingAdminEmail: string | null;
      if (hasUser) {
        next = 'completed';
        pendingAdminEmail = null;
      } else if (oidc) {
        next = 'oidc-pending';
        pendingAdminEmail = oidc.adminEmail;
        tx.insert(systemSettings).values({ id: ROW, automaticRegistration: false }).onConflictDoUpdate({
          target: systemSettings.id,
          set: { automaticRegistration: false }
        }).run();
      } else if (row?.onboardingState === 'oidc-pending' && this.hasSavedOidcSetup(tx)) {
        next = 'oidc-pending';
        pendingAdminEmail = row.pendingAdminEmail;
      } else {
        // Also when the OIDC variables were removed before anyone logged in.
        next = row?.onboardingState === 'completed' ? 'completed' : 'required';
        pendingAdminEmail = null;
      }
      if (!row) {
        tx.insert(instanceState).values({ id: ROW, onboardingState: next, pendingAdminEmail }).run();
      } else if (row.onboardingState !== next || row.pendingAdminEmail !== pendingAdminEmail) {
        tx.update(instanceState).set({ onboardingState: next, pendingAdminEmail }).where(eq(instanceState.id, ROW))
          .run();
      }
      return next;
    });
    this.logger.log(`Administrator onboarding state: ${state}`);
  }

  /** A pending OIDC setup saved on the onboarding page (AO-20). */
  private hasSavedOidcSetup(tx: Pick<Database['db'], 'select'>): boolean {
    const settings = tx.select().from(systemSettings).where(eq(systemSettings.id, ROW)).get();
    return settings?.oidcIssuer != null;
  }

  /** Read on every call, so that it is always current (A-4.2: well under a millisecond). */
  current(): OnboardingState {
    const row = this.database.db.select().from(instanceState).where(eq(instanceState.id, ROW)).get();
    return row?.onboardingState ?? 'required';
  }

  status(): OnboardingStatus {
    return {
      state: this.current(),
      oidcFromEnvironment: this.config.oidc !== undefined,
      setupTokenConfigured: this.config.setupToken !== undefined
    };
  }

  /** The email of the administrator the first OIDC login creates, while `oidc-pending` (AO-27). */
  pendingAdminEmail(): string | undefined {
    const row = this.database.db.select().from(instanceState).where(eq(instanceState.id, ROW)).get();
    return row?.onboardingState === 'oidc-pending' ? (row.pendingAdminEmail ?? undefined) : undefined;
  }
}
