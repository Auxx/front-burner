import {
  DATABASE,
  Database,
  instanceState,
  LoginAuditReason,
  systemSettings,
  User,
  users
} from '@front-burner/server-core-database';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { OnboardingStateService } from '../onboarding/onboarding-state.service';
import type { OidcSettings } from './oidc-settings.service';

/** Who the provider says logged in, from the validated ID token. */
export interface OidcIdentity {
  issuer: string;
  subject: string;
  email: string | undefined;
  emailVerified: boolean | undefined;
  name: string | undefined;
}

export type OidcUserResult =
  | { ok: true; user: User; completedOnboarding: boolean; }
  | Failure;

type Failure = { ok: false; reason: LoginAuditReason; userId?: number; };

const sameEmail = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Finds, links or creates the user of an OIDC login (LG-18 to LG-20, LG-24, AO-27, AO-28). */
@Injectable()
export class OidcUserService {
  private readonly logger = new Logger(OidcUserService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly onboardingState: OnboardingStateService
  ) {}

  resolve(identity: OidcIdentity, settings: OidcSettings): OidcUserResult {
    if (settings.requireVerifiedEmail && identity.emailVerified !== true) {
      return { ok: false, reason: 'email-not-verified' };
    }

    if (this.onboardingState.current() === 'oidc-pending') {
      const pending = this.onboardingState.pendingAdminEmail();
      if (identity.email === undefined || pending === undefined || !sameEmail(identity.email, pending)) {
        return { ok: false, reason: 'admin-email-mismatch' };
      }
      const created = this.completeOnboarding(identity, identity.email);
      if (created) {
        this.logger.log('Administrator onboarding completed');
        return { ok: true, user: created, completedOnboarding: true };
      }
      // Onboarding was completed meanwhile: this is an ordinary login now.
    }

    const user = this.findOrCreate(identity);
    if (user.ok === false) {
      return user;
    }
    if (user.user.disabled) {
      return { ok: false, reason: 'user-disabled', userId: user.user.id };
    }
    return { ok: true, user: user.user, completedOnboarding: false };
  }

  /** AO-28 in one transaction that only proceeds while onboarding is still `oidc-pending`. */
  private completeOnboarding(identity: OidcIdentity, email: string): User | undefined {
    return this.database.db.transaction(tx => {
      const closed = tx
        .update(instanceState)
        .set({ onboardingState: 'completed', pendingAdminEmail: null })
        .where(and(eq(instanceState.id, 1), eq(instanceState.onboardingState, 'oidc-pending')))
        .run();
      if (closed.changes !== 1) {
        return undefined;
      }
      return tx.insert(users).values(this.newUser(identity, email, 'administrator')).returning().get();
    });
  }

  private findOrCreate(identity: OidcIdentity): { ok: true; user: User; } | Failure {
    const { db } = this.database;
    return db.transaction(tx => {
      const linked = tx.select().from(users)
        .where(and(eq(users.oidcIssuer, identity.issuer), eq(users.oidcSubject, identity.subject)))
        .get();
      if (linked) {
        return { ok: true, user: linked };
      }
      if (identity.email === undefined) {
        // Without an email there is nothing to link or create.
        return { ok: false, reason: 'invalid-id-token' };
      }
      const byEmail = tx.select().from(users).where(eq(sql`lower(${users.email})`, identity.email.toLowerCase()))
        .get();
      if (byEmail?.loginMethod === 'password') {
        return { ok: false, reason: 'password-user', userId: byEmail.id };
      }
      if (byEmail && byEmail.oidcSubject === null) {
        const user = tx.update(users)
          .set({ oidcIssuer: identity.issuer, oidcSubject: identity.subject })
          .where(eq(users.id, byEmail.id))
          .returning()
          .get();
        return { ok: true, user };
      }
      const automaticRegistration = tx.select().from(systemSettings).where(eq(systemSettings.id, 1)).get()
        ?.automaticRegistration ?? false;
      // An OIDC user linked to another identity keeps its email: no second account is created.
      if (byEmail || !automaticRegistration) {
        return { ok: false, reason: 'registration-disabled' };
      }
      return {
        ok: true,
        user: tx.insert(users).values(this.newUser(identity, identity.email, 'user')).returning().get()
      };
    });
  }

  private newUser(identity: OidcIdentity, email: string, role: User['role']) {
    return {
      email,
      displayName: identity.name?.trim() || email.split('@')[0] || email,
      role,
      loginMethod: 'oidc' as const,
      passwordHash: null,
      oidcIssuer: identity.issuer,
      oidcSubject: identity.subject,
      createdAt: new Date()
    };
  }
}
