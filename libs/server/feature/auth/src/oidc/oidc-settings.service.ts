import { CONFIG, Config } from '@front-burner/server-core-config';
import { SECRET_BOX, SecretBox } from '@front-burner/server-core-crypto';
import { DATABASE, Database, systemSettings } from '@front-burner/server-core-database';
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
}

/** Where the OIDC settings come from: the environment wins over system settings (AO-35). */
@Injectable()
export class OidcSettingsService {
  constructor(
    @Inject(CONFIG) private readonly config: Pick<Config, 'oidc'>,
    @Inject(DATABASE) private readonly database: Database,
    @Inject(SECRET_BOX) private readonly secretBox: SecretBox
  ) {}

  /** Read on every call, so that a setup saved meanwhile is used at once. */
  current(): OidcSettings | undefined {
    const oidc = this.config.oidc;
    if (oidc) {
      return {
        source: 'environment',
        issuer: oidc.issuer,
        clientId: oidc.clientId,
        clientSecret: oidc.clientSecret,
        scopes: oidc.scopes,
        requireVerifiedEmail: oidc.requireVerifiedEmail
      };
    }
    const row = this.database.db.select().from(systemSettings).where(eq(systemSettings.id, ROW)).get();
    if (!row?.oidcIssuer || !row.oidcClientId || !row.oidcClientSecret) {
      return undefined;
    }
    return {
      source: 'onboarding',
      issuer: row.oidcIssuer,
      clientId: row.oidcClientId,
      clientSecret: this.secretBox.decrypt(row.oidcClientSecret, OIDC_CLIENT_SECRET_BINDING),
      scopes: row.oidcScopes ?? DEFAULT_SCOPES,
      requireVerifiedEmail: row.oidcRequireVerifiedEmail ?? true
    };
  }
}
