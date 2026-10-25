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
}
