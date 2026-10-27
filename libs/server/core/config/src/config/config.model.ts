/** Instance configuration, read once at startup from `FRONT_BURNER_*` variables. */
export interface Config {
  port: number;
  /** Entries for Express's `trust proxy` setting (A-1.15). */
  trustedProxies: string[];
  logLevel: 'error' | 'warn' | 'info' | 'debug';
  logFormat: 'json' | 'pretty';
  /** Always absolute. */
  dataDir: string;
  /** Undefined when not set or too short (administrator onboarding is then unavailable). */
  setupToken: string | undefined;
  /** Signs the auth tokens (LG-28). At least 32 characters. */
  jwtSecret: string;
  /** Encrypts the stored secrets (NF-8.1). At least 32 characters, never equal to `jwtSecret`. */
  encryptionKey: string;
  /** `FRONT_BURNER_ENCRYPTION_KEY_RESET=confirm`: delete every stored secret if the key does not match (NF-8.6). */
  encryptionKeyReset: boolean;
  /** Also refuse private and loopback addresses for outbound connections (AR-57, A-5.8). */
  blockPrivateNetworks: boolean;
  authTokenTtlMs: number;
  /** The lifetime of a session and its refresh tokens, from login (LG-29). */
  refreshTokenTtlMs: number;
  loginAuditRetentionMs: number;
  /** OIDC and the first administrator from the environment (AO-30); undefined when none of the variables is set. */
  oidc: OidcEnvironment | undefined;
}

/** The `FRONT_BURNER_OIDC_*` variables and `FRONT_BURNER_ADMIN_EMAIL` (AO-30). */
export interface OidcEnvironment {
  /** An `https:` URL without query or fragment. */
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  requireVerifiedEmail: boolean;
  adminEmail: string;
}
