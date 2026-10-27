import { SECRET_BOX, SecretBox } from '@front-burner/server-core-crypto';
import { DATABASE, Database, instanceState, systemSettings } from '@front-burner/server-core-database';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { EgressHttpClient } from '@front-burner/server-core-security';
import type { OidcSetupRequest, OidcSetupView } from '@front-burner/shared-contracts';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import * as client from 'openid-client';
import { OIDC_CLIENT_SECRET_BINDING } from '../oidc/oidc-settings.service';

const ROW = 1;
const DISCOVERY_TIMEOUT_S = 10;
/** oauth4webapi's code for a document whose `issuer` is not the expected one; `openid-client` does not export it. */
const ATTRIBUTE_COMPARISON_FAILED = 'OAUTH_JSON_ATTRIBUTE_COMPARISON_FAILED';

/** The OIDC path of administrator onboarding (AO-21 to AO-24). */
@Injectable()
export class OidcSetupService {
  private readonly logger = new Logger(OidcSetupService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(SECRET_BOX) private readonly secretBox: SecretBox,
    private readonly egress: EgressHttpClient
  ) {}

  /**
   * Fetches the issuer's discovery document (AO-23). The document's `issuer`
   * must be exactly the one given, as OpenID Connect Discovery requires:
   * `openid-client` compares them as URLs, which forgives a trailing slash.
   *
   * @throws ApiErrorException a field error on `issuer` when the check fails.
   */
  async check(issuer: string): Promise<void> {
    let documentIssuer: string;
    try {
      const configuration = await client.discovery(new URL(issuer), 'onboarding-check', undefined, undefined, {
        [client.customFetch]: (url, options) =>
          this.egress.fetch(url, options as Parameters<EgressHttpClient['fetch']>[1]) as unknown as Promise<Response>,
        timeout: DISCOVERY_TIMEOUT_S
      });
      documentIssuer = configuration.serverMetadata().issuer;
    } catch (error) {
      throw issuerError(issuer, error);
    }
    if (documentIssuer !== issuer) {
      throw ApiErrorException.forFields([
        { path: 'issuer', code: 'oidc-issuer-mismatch', params: { expected: documentIssuer } }
      ]);
    }
  }

  /**
   * Checks the issuer, then saves the setup and puts onboarding in
   * `oidc-pending`, in one transaction (AO-24, AO-26).
   *
   * @throws NotFoundException when onboarding is `completed` meanwhile.
   * @throws ApiErrorException when the issuer is refused, or no secret is sent and none is saved.
   */
  async save(request: OidcSetupRequest): Promise<void> {
    await this.check(request.issuer);
    this.database.db.transaction(tx => {
      const opened = tx
        .update(instanceState)
        .set({ onboardingState: 'oidc-pending', pendingAdminEmail: request.adminEmail })
        .where(and(eq(instanceState.id, ROW), inArray(instanceState.onboardingState, [ 'required', 'oidc-pending' ])))
        .run();
      if (opened.changes !== 1) {
        throw new NotFoundException();
      }
      const saved = tx.select().from(systemSettings).where(eq(systemSettings.id, ROW)).get();
      const clientSecret = request.clientSecret
        ? this.secretBox.encrypt(request.clientSecret, OIDC_CLIENT_SECRET_BINDING)
        : saved?.oidcClientSecret;
      if (!clientSecret) {
        throw ApiErrorException.forFields([ { path: 'clientSecret', code: 'required', params: {} } ]);
      }
      const values = {
        oidcIssuer: request.issuer,
        oidcClientId: request.clientId,
        oidcClientSecret: clientSecret,
        oidcScopes: request.scopes,
        oidcRequireVerifiedEmail: request.requireVerifiedEmail,
        automaticRegistration: false
      };
      tx.insert(systemSettings).values({ id: ROW, ...values }).onConflictDoUpdate({
        target: systemSettings.id,
        set: values
      }).run();
    });
    this.logger.log('OIDC setup saved');
  }

  /** The saved setup for the pre-filled form (AO-16, AO-26), never the secret. */
  current(): OidcSetupView | undefined {
    const { db } = this.database;
    const settings = db.select().from(systemSettings).where(eq(systemSettings.id, ROW)).get();
    const state = db.select().from(instanceState).where(eq(instanceState.id, ROW)).get();
    if (!settings?.oidcIssuer || !settings.oidcClientId || state?.onboardingState !== 'oidc-pending') {
      return undefined;
    }
    return {
      issuer: settings.oidcIssuer,
      clientId: settings.oidcClientId,
      scopes: settings.oidcScopes ?? '',
      requireVerifiedEmail: settings.oidcRequireVerifiedEmail ?? true,
      adminEmail: state.pendingAdminEmail ?? '',
      hasClientSecret: settings.oidcClientSecret != null
    };
  }
}

/** Maps a failed discovery to the field error of AO-23. */
function issuerError(issuer: string, error: unknown): ApiErrorException {
  const causes = causesOf(error) as { code?: unknown; body?: { issuer?: unknown; }; }[];
  const codes = causes.map(cause => cause?.code);
  if (codes.includes(ATTRIBUTE_COMPARISON_FAILED)) {
    const expected = causes.find(cause => cause?.body !== undefined)?.body?.issuer;
    return ApiErrorException.forFields([
      { path: 'issuer', code: 'oidc-issuer-mismatch', params: { expected: String(expected ?? '') } }
    ]);
  }
  // openid-client's own codes all say the server answered, but not with a usable document.
  if (codes.some(code => typeof code === 'string' && code.startsWith('OAUTH_'))) {
    return ApiErrorException.forFields([ { path: 'issuer', code: 'oidc-discovery-invalid', params: {} } ]);
  }
  // A network error, a timeout or a refused address (AR-57) all look the same to the operator.
  return ApiErrorException.forFields([
    { path: 'issuer', code: 'oidc-issuer-unreachable', params: { host: new URL(issuer).host } }
  ]);
}

/** The error and its chain of causes. */
function causesOf(error: unknown): unknown[] {
  const chain: unknown[] = [];
  for (
    let current = error;
    current !== undefined && chain.length < 10;
    current = (current as { cause?: unknown; })?.cause
  ) {
    chain.push(current);
  }
  return chain;
}
