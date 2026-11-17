import { CONFIG, Config, type RequiredClaim } from '@front-burner/server-core-config';
import { SECRET_BOX, SecretBox } from '@front-burner/server-core-crypto';
import { DATABASE, Database, type SystemSettings, systemSettings } from '@front-burner/server-core-database';
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

const ROW = 1;
const DEFAULT_SCOPES = 'openid email profile';

/** The binding the stored client secret is encrypted with (A-4.8). */
export const OIDC_CLIENT_SECRET_BINDING = { table: 'system_settings', recordId: ROW } as const;

export interface OidcSettings {
  /** The environment (AO-30) or a setup saved on the onboarding page (AO-20). */
  source: 'environment' | 'onboarding';
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  requireVerifiedEmail: boolean;
  /** The environment's (AO-41) or the saved one (AO-40), whatever `source` is; temporary MVP measure. */
  requiredClaim: RequiredClaim | undefined;
}

/** Where the OIDC settings come from: the environment wins over system settings (AO-35). */
@Injectable()
export class OidcSettingsService {
  constructor(
    @Inject(CONFIG) private readonly config: Pick<Config, 'oidc' | 'oidcRequiredClaim'>,
    @Inject(DATABASE) private readonly database: Database,
    @Inject(SECRET_BOX) private readonly secretBox: SecretBox
  ) {}

  /** Read on every call, so that a setup saved meanwhile is used at once. */
  current(): OidcSettings | undefined {
    const oidc = this.config.oidc;
    // The row is read only when the environment does not settle everything.
    const environmentClaim = this.config.oidcRequiredClaim;
    const row = oidc && environmentClaim !== undefined ? undefined : this.savedRow();
    // AO-41: the environment's claim, or its `none` (null), wins over a saved one.
    const requiredClaim = environmentClaim === undefined ? savedClaimOf(row) : environmentClaim ?? undefined;
    if (oidc) {
      return {
        source: 'environment',
        issuer: oidc.issuer,
        clientId: oidc.clientId,
        clientSecret: oidc.clientSecret,
        scopes: oidc.scopes,
        requireVerifiedEmail: oidc.requireVerifiedEmail,
        requiredClaim
      };
    }
    if (!row?.oidcIssuer || !row.oidcClientId || !row.oidcClientSecret) {
      return undefined;
    }
    return {
      source: 'onboarding',
      issuer: row.oidcIssuer,
      clientId: row.oidcClientId,
      clientSecret: this.secretBox.decrypt(row.oidcClientSecret, OIDC_CLIENT_SECRET_BINDING),
      scopes: row.oidcScopes ?? DEFAULT_SCOPES,
      requireVerifiedEmail: row.oidcRequireVerifiedEmail ?? true,
      requiredClaim
    };
  }

  private savedRow(): SystemSettings | undefined {
    return this.database.db.select().from(systemSettings).where(eq(systemSettings.id, ROW)).get();
  }
}

/** The claim saved from the onboarding page (AO-40), when both its parts are. */
function savedClaimOf(row: SystemSettings | undefined): RequiredClaim | undefined {
  return row?.oidcRequiredClaimName && row.oidcRequiredClaimValue
    ? { name: row.oidcRequiredClaimName, value: row.oidcRequiredClaimValue }
    : undefined;
}
