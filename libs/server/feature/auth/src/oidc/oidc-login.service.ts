import { DATABASE, Database, LoginAuditReason, users } from '@front-burner/server-core-database';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { constantTimeEquals, EgressRefusedError } from '@front-burner/server-core-security';
import type { RefreshTokenDelivery } from '@front-burner/shared-contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import * as client from 'openid-client';
import { AuditInput, LoginAuditService, RequestInfo } from '../login/login-audit.service';
import { OnboardingStateService } from '../onboarding/onboarding-state.service';
import { IssuedSession, SessionService } from '../sessions/session.service';
import { OidcProviderService } from './oidc-provider.service';
import { OidcSettingsService } from './oidc-settings.service';
import { OidcIdentity, OidcUserService } from './oidc-user.service';
import { OneTimeCodes } from './one-time-codes';
import { PendingLogins } from './pending-logins';

export type OidcOutcome = { ok: true; code: string; } | { ok: false; reason: LoginAuditReason; };

interface ProviderFailure {
  reason: LoginAuditReason;
  providerError?: string;
  providerErrorDescription?: string;
}

/** The authorization code flow with PKCE (LG-17 to LG-23), through the egress client (A-7.8). */
@Injectable()
export class OidcLoginService {
  private readonly logger = new Logger(OidcLoginService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly provider: OidcProviderService,
    private readonly settings: OidcSettingsService,
    private readonly oidcUsers: OidcUserService,
    private readonly onboardingState: OnboardingStateService,
    private readonly sessions: SessionService,
    private readonly audit: LoginAuditService,
    private readonly pendingLogins: PendingLogins,
    private readonly codes: OneTimeCodes
  ) {}

  /**
   * Begins a login: the provider's authorization URL and the `state` that the
   * callback must bring back in the browser's cookie.
   *
   * @throws Error when OIDC is not configured or the provider cannot be discovered.
   */
  async start(redirectUri: string): Promise<{ authorizationUrl: URL; state: string; }> {
    const configuration = await this.provider.configuration();
    const settings = this.settings.current();
    if (settings === undefined) {
      throw new Error('OIDC is not configured');
    }
    const codeVerifier = client.randomPKCECodeVerifier();
    const state = client.randomState();
    const nonce = client.randomNonce();
    const authorizationUrl = client.buildAuthorizationUrl(configuration, {
      redirect_uri: redirectUri,
      scope: settings.scopes,
      code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: 'S256',
      state,
      nonce
    });
    this.pendingLogins.add(state, { codeVerifier, nonce, redirectUri });
    return { authorizationUrl, state };
  }

  /**
   * Finishes a login on the provider's callback. A success gives the one-time
   * code of LG-22; every failure is audited and logged (LG-41, LG-47, AO-39).
   */
  async complete(callbackUrl: URL, cookieState: string | undefined, info: RequestInfo): Promise<OidcOutcome> {
    const wasPending = this.onboardingState.current() === 'oidc-pending';
    const fail = (failure: ProviderFailure, extra: Partial<AuditInput> = {}): OidcOutcome => {
      this.audit.record({
        method: 'oidc',
        outcome: 'failure',
        reason: failure.reason,
        providerError: failure.providerError,
        providerErrorDescription: failure.providerErrorDescription,
        ip: info.ip,
        userAgent: info.userAgent,
        ...extra
      });
      if (wasPending) {
        this.logger.warn({ reason: failure.reason }, 'OIDC login failed while onboarding is pending');
      }
      return { ok: false, reason: failure.reason };
    };

    const urlState = callbackUrl.searchParams.get('state');
    const pending = cookieState !== undefined && urlState !== null && constantTimeEquals(urlState, cookieState)
      ? this.pendingLogins.take(cookieState)
      : undefined;
    const settings = this.settings.current();
    if (pending === undefined || cookieState === undefined || settings === undefined) {
      return fail({ reason: 'state-mismatch' });
    }

    let identity: OidcIdentity;
    try {
      const configuration = await this.provider.configuration();
      const tokens = await client.authorizationCodeGrant(configuration, callbackUrl, {
        pkceCodeVerifier: pending.codeVerifier,
        expectedState: cookieState,
        expectedNonce: pending.nonce,
        idTokenExpected: true
      }, { redirect_uri: pending.redirectUri });
      const claims = tokens.claims();
      if (claims === undefined) {
        return fail({ reason: 'invalid-id-token' });
      }
      identity = {
        issuer: claims.iss,
        subject: claims.sub,
        email: typeof claims['email'] === 'string' ? claims['email'] : undefined,
        emailVerified: typeof claims['email_verified'] === 'boolean' ? claims['email_verified'] : undefined,
        name: typeof claims['name'] === 'string' ? claims['name'] : undefined
      };
    } catch (error) {
      return fail(providerFailureOf(error));
    }

    const auditIdentity = { email: identity.email, issuer: identity.issuer, subject: identity.subject };
    const result = this.oidcUsers.resolve(identity, settings);
    if (result.ok === false) {
      return fail({ reason: result.reason }, { ...auditIdentity, userId: result.userId });
    }
    // The state cookie stays with the browser that completed the login, which alone can exchange the code.
    return { ok: true, code: this.codes.issue({ userId: result.user.id, ...auditIdentity }, cookieState) };
  }

  /**
   * Exchanges a one-time code for a session (LG-22, LG-23), in the browser
   * whose state cookie (`binding`) completed the login.
   *
   * @throws ApiErrorException `oidc-code-invalid` (401) for an unknown, used or
   *   expired code, or one from another browser.
   */
  async exchange(
    code: string,
    binding: string | undefined,
    delivery: RefreshTokenDelivery,
    info: RequestInfo
  ): Promise<IssuedSession> {
    const login = this.codes.take(code, binding);
    const user = login === undefined
      ? undefined
      : this.database.db.select().from(users).where(eq(users.id, login.userId)).get();
    if (login === undefined || user === undefined || user.disabled) {
      throw new ApiErrorException(401, 'oidc-code-invalid', {}, 'The OIDC login code is not valid');
    }
    const issued = await this.sessions.start(user, 'oidc', delivery);
    this.audit.record({
      method: 'oidc',
      outcome: 'success',
      reason: 'success',
      email: login.email,
      issuer: login.issuer,
      subject: login.subject,
      userId: user.id,
      sessionId: issued.sessionId,
      ip: info.ip,
      userAgent: info.userAgent
    });
    this.logger.log({ userId: user.id, sessionId: issued.sessionId, method: 'oidc' }, 'Login succeeded');
    return issued;
  }
}

/** Maps what `openid-client` throws to the reasons of LG-43. */
function providerFailureOf(error: unknown): ProviderFailure {
  if (error instanceof client.AuthorizationResponseError) {
    return {
      reason: 'provider-error',
      providerError: error.error,
      providerErrorDescription: error.error_description
    };
  }
  if (error instanceof client.ResponseBodyError) {
    return {
      reason: 'code-exchange-failed',
      providerError: error.error,
      providerErrorDescription: error.error_description
    };
  }
  if (
    error instanceof TypeError || error instanceof EgressRefusedError
    || (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'))
  ) {
    return { reason: 'provider-unreachable' };
  }
  if (
    error instanceof client.ClientError
    && (error.code === 'OAUTH_RESPONSE_IS_NOT_CONFORM' || error.code === 'OAUTH_RESPONSE_IS_NOT_JSON')
  ) {
    return { reason: 'code-exchange-failed' };
  }
  return { reason: 'invalid-id-token' };
}
