import { parseDuration } from '@front-burner/shared-util';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compile } from 'proxy-addr';
import { z } from 'zod';
import { Config, OidcEnvironment } from './config.model';

const PREFIX = 'FRONT_BURNER_';
const SETUP_TOKEN = 'FRONT_BURNER_SETUP_TOKEN';
const SETUP_TOKEN_FILE = 'FRONT_BURNER_SETUP_TOKEN_FILE';
const MIN_SETUP_TOKEN_LENGTH = 16;
const JWT_SECRET = 'FRONT_BURNER_JWT_SECRET';
const JWT_SECRET_FILE = 'FRONT_BURNER_JWT_SECRET_FILE';
const MIN_JWT_SECRET_LENGTH = 32;
const ENCRYPTION_KEY = 'FRONT_BURNER_ENCRYPTION_KEY';
const ENCRYPTION_KEY_FILE = 'FRONT_BURNER_ENCRYPTION_KEY_FILE';
const MIN_ENCRYPTION_KEY_LENGTH = 32;
const OIDC_ISSUER = 'FRONT_BURNER_OIDC_ISSUER';
const OIDC_CLIENT_ID = 'FRONT_BURNER_OIDC_CLIENT_ID';
const OIDC_CLIENT_SECRET = 'FRONT_BURNER_OIDC_CLIENT_SECRET';
const OIDC_CLIENT_SECRET_FILE = 'FRONT_BURNER_OIDC_CLIENT_SECRET_FILE';
const OIDC_SCOPES = 'FRONT_BURNER_OIDC_SCOPES';
const OIDC_REQUIRE_VERIFIED_EMAIL = 'FRONT_BURNER_OIDC_REQUIRE_VERIFIED_EMAIL';
const ADMIN_EMAIL = 'FRONT_BURNER_ADMIN_EMAIL';
const OIDC_VARIABLES = [
  OIDC_ISSUER,
  OIDC_CLIENT_ID,
  OIDC_CLIENT_SECRET,
  OIDC_CLIENT_SECRET_FILE,
  OIDC_SCOPES,
  OIDC_REQUIRE_VERIFIED_EMAIL,
  ADMIN_EMAIL
];
const DEFAULT_TRUSTED_PROXIES = 'loopback, linklocal, uniquelocal';

function duration(defaultValue: string) {
  return z.string().default(defaultValue).transform((value, context) => {
    const ms = parseDuration(value);
    if (ms === undefined) {
      context.addIssue({ code: 'custom', message: 'must be a number followed by s, m, h or d' });
      return z.NEVER;
    }
    return ms;
  });
}

export interface ConfigIssue {
  variable: string;
  message: string;
}

/** Thrown with every invalid variable. Messages never contain a secret value. */
export class ConfigError extends Error {
  constructor(readonly issues: ConfigIssue[], readonly warnings: string[] = []) {
    super(
      `Invalid configuration:\n${issues.map(issue => `- ${issue.variable}: ${issue.message}`).join('\n')}`
    );
    this.name = 'ConfigError';
  }
}

function isHttpsIssuer(value: string): boolean {
  if (!URL.canParse(value)) {
    return false;
  }
  const url = new URL(value);
  return url.protocol === 'https:' && url.search === '' && url.hash === '' && !value.includes('#')
    && !value.includes('?');
}

function isTrustedProxy(entry: string): boolean {
  try {
    compile(entry);
    return true;
  } catch {
    return false;
  }
}

// Messages are fixed text: Zod's own messages could echo the input value.
const schema = z.object({
  FRONT_BURNER_PORT: z
    .string()
    .default('8080')
    .refine(v => /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 65535, {
      message: 'must be an integer from 1 to 65535'
    })
    .transform(Number),
  FRONT_BURNER_TRUSTED_PROXIES: z
    .string()
    .default(DEFAULT_TRUSTED_PROXIES)
    .transform(v => v.split(',').map(entry => entry.trim()))
    .refine(entries => entries.every(entry => entry !== '' && isTrustedProxy(entry)), {
      message: 'must be a comma-separated list of proxy names, IP addresses or CIDR ranges'
    }),
  FRONT_BURNER_LOG_LEVEL: z.enum([ 'error', 'warn', 'info', 'debug' ], {
    error: () => 'must be one of error, warn, info, debug'
  }).default('info'),
  FRONT_BURNER_LOG_FORMAT: z.enum([ 'json', 'pretty' ], {
    error: () => 'must be one of json, pretty'
  }).default('json'),
  FRONT_BURNER_DATA_DIR: z.string().default('/data'),
  [SETUP_TOKEN]: z.string().optional(),
  [SETUP_TOKEN_FILE]: z.string().optional(),
  [JWT_SECRET]: z.string().optional(),
  [JWT_SECRET_FILE]: z.string().optional(),
  [ENCRYPTION_KEY]: z.string().optional(),
  [ENCRYPTION_KEY_FILE]: z.string().optional(),
  FRONT_BURNER_ENCRYPTION_KEY_RESET: z.literal('confirm', { error: () => 'must be confirm' }).optional(),
  FRONT_BURNER_BLOCK_PRIVATE_NETWORKS: z.enum([ 'true', 'false' ], {
    error: () => 'must be true or false'
  }).default('false').transform(v => v === 'true'),
  FRONT_BURNER_AUTH_TOKEN_TTL: duration('15m'),
  FRONT_BURNER_REFRESH_TOKEN_TTL: duration('30d'),
  FRONT_BURNER_LOGIN_AUDIT_RETENTION: duration('90d'),
  [OIDC_ISSUER]: z.string().refine(isHttpsIssuer, { message: 'must be an https: URL without query or fragment' })
    .optional(),
  [OIDC_CLIENT_ID]: z.string().optional(),
  [OIDC_CLIENT_SECRET]: z.string().optional(),
  [OIDC_CLIENT_SECRET_FILE]: z.string().optional(),
  [OIDC_SCOPES]: z.string().default('openid email profile'),
  [OIDC_REQUIRE_VERIFIED_EMAIL]: z.enum([ 'true', 'false' ], {
    error: () => 'must be true or false'
  }).default('true').transform(v => v === 'true'),
  [ADMIN_EMAIL]: z.string().trim().pipe(
    z.email({ error: () => 'must be a valid email address' }).max(254, {
      error: () => 'must be a valid email address'
    })
  ).optional()
}).refine(v => v[SETUP_TOKEN] === undefined || v[SETUP_TOKEN_FILE] === undefined, {
  path: [ SETUP_TOKEN ],
  message: `cannot be set together with ${SETUP_TOKEN_FILE}`
}).refine(v => v[JWT_SECRET] === undefined || v[JWT_SECRET_FILE] === undefined, {
  path: [ JWT_SECRET ],
  message: `cannot be set together with ${JWT_SECRET_FILE}`
}).refine(v => v[ENCRYPTION_KEY] === undefined || v[ENCRYPTION_KEY_FILE] === undefined, {
  path: [ ENCRYPTION_KEY ],
  message: `cannot be set together with ${ENCRYPTION_KEY_FILE}`
}).refine(v => v[OIDC_CLIENT_SECRET] === undefined || v[OIDC_CLIENT_SECRET_FILE] === undefined, {
  path: [ OIDC_CLIENT_SECRET ],
  message: `cannot be set together with ${OIDC_CLIENT_SECRET_FILE}`
});

const KNOWN_VARIABLES = new Set(Object.keys(schema.shape));

/**
 * Reads the configuration from environment variables (A-1.15, NF-8.2).
 *
 * @throws ConfigError listing every invalid variable.
 */
export function loadConfig(
  env: Record<string, string | undefined>,
  options: { cwd?: string; readFile?: (path: string) => string; } = {}
): { config: Config; warnings: string[]; } {
  const cwd = options.cwd ?? process.cwd();
  const readFile = options.readFile ?? ((path: string) => readFileSync(path, 'utf8'));
  const warnings: string[] = [];

  // An empty value counts as unset, as container orchestrators often pass one.
  const input: Record<string, string> = {};
  for (const [ name, value ] of Object.entries(env)) {
    if (name.startsWith(PREFIX)) {
      if (!KNOWN_VARIABLES.has(name)) {
        warnings.push(`Unknown variable ${name} is ignored.`);
      } else if (value !== undefined && value !== '') {
        input[name] = value;
      }
    }
  }

  const issues: ConfigIssue[] = [];
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push({ variable: String(issue.path[0]), message: issue.message });
    }
  }

  /** A secret from its variable or, when that is unset, from the file its `_FILE` variable names (NF-8.2). */
  const readSecret = (variable: string, fileVariable: string) => {
    const file = input[fileVariable];
    if (input[variable] !== undefined || file === undefined) {
      return { value: input[variable], variable };
    }
    try {
      return { value: readFile(file).replace(/\r?\n$/, ''), variable: fileVariable };
    } catch {
      issues.push({ variable: fileVariable, message: 'the file could not be read' });
      return { value: undefined, variable: fileVariable };
    }
  };

  const jwtSecret = readSecret(JWT_SECRET, JWT_SECRET_FILE);
  if (jwtSecret.value === undefined) {
    if (input[JWT_SECRET_FILE] === undefined) {
      issues.push({ variable: JWT_SECRET, message: 'is required' });
    }
  } else if (jwtSecret.value.length < MIN_JWT_SECRET_LENGTH) {
    issues.push({ variable: jwtSecret.variable, message: `must be at least ${MIN_JWT_SECRET_LENGTH} characters` });
  }

  const encryptionKey = readSecret(ENCRYPTION_KEY, ENCRYPTION_KEY_FILE);
  if (encryptionKey.value === undefined) {
    if (input[ENCRYPTION_KEY_FILE] === undefined) {
      issues.push({ variable: ENCRYPTION_KEY, message: 'is required' });
    }
  } else if (encryptionKey.value.length < MIN_ENCRYPTION_KEY_LENGTH) {
    issues.push({
      variable: encryptionKey.variable,
      message: `must be at least ${MIN_ENCRYPTION_KEY_LENGTH} characters`
    });
  } else if (encryptionKey.value === jwtSecret.value) {
    issues.push({ variable: encryptionKey.variable, message: `must differ from ${JWT_SECRET}` });
  }

  const token = readSecret(SETUP_TOKEN, SETUP_TOKEN_FILE);
  let setupToken = token.value;
  const tokenVariable = token.variable;
  if (setupToken !== undefined && setupToken.length < MIN_SETUP_TOKEN_LENGTH) {
    warnings.push(
      `${tokenVariable} gives a setup token shorter than ${MIN_SETUP_TOKEN_LENGTH} characters; it is ignored.`
    );
    setupToken = undefined;
  } else if (setupToken !== undefined && /^\s|\s$/.test(setupToken)) {
    // It is kept as it is, but a password field cannot send a line break.
    warnings.push(
      `${tokenVariable} gives a setup token that starts or ends with whitespace; it must be typed exactly, and the onboarding page cannot send a line break.`
    );
  }

  // AO-31: all required OIDC variables or none of them.
  let oidc: OidcEnvironment | undefined;
  const oidcSet = OIDC_VARIABLES.some(variable => input[variable] !== undefined);
  const clientSecret = readSecret(OIDC_CLIENT_SECRET, OIDC_CLIENT_SECRET_FILE);
  if (oidcSet) {
    const required: [ string, string | undefined ][] = [
      [ OIDC_ISSUER, input[OIDC_ISSUER] ],
      [ OIDC_CLIENT_ID, input[OIDC_CLIENT_ID] ],
      [ OIDC_CLIENT_SECRET, input[OIDC_CLIENT_SECRET] ?? input[OIDC_CLIENT_SECRET_FILE] ],
      [ ADMIN_EMAIL, input[ADMIN_EMAIL] ]
    ];
    for (const [ variable, value ] of required) {
      if (value === undefined) {
        issues.push({ variable, message: 'is required when other FRONT_BURNER_OIDC_* variables are set' });
      }
    }
    const values = parsed.data;
    const issuer = values?.[OIDC_ISSUER];
    const clientId = values?.[OIDC_CLIENT_ID];
    const adminEmail = values?.[ADMIN_EMAIL];
    if (
      values !== undefined && issuer !== undefined && clientId !== undefined && adminEmail !== undefined
      && clientSecret.value !== undefined
    ) {
      oidc = {
        issuer,
        clientId,
        clientSecret: clientSecret.value,
        scopes: values[OIDC_SCOPES],
        requireVerifiedEmail: values[OIDC_REQUIRE_VERIFIED_EMAIL],
        adminEmail
      };
    }
  }

  if (
    !parsed.success
    || issues.length > 0
    || jwtSecret.value === undefined
    || encryptionKey.value === undefined
  ) {
    throw new ConfigError(issues, warnings);
  }

  const values = parsed.data;
  return {
    config: {
      port: values.FRONT_BURNER_PORT,
      trustedProxies: values.FRONT_BURNER_TRUSTED_PROXIES,
      logLevel: values.FRONT_BURNER_LOG_LEVEL,
      logFormat: values.FRONT_BURNER_LOG_FORMAT,
      dataDir: resolve(cwd, values.FRONT_BURNER_DATA_DIR),
      setupToken,
      jwtSecret: jwtSecret.value,
      encryptionKey: encryptionKey.value,
      encryptionKeyReset: values.FRONT_BURNER_ENCRYPTION_KEY_RESET === 'confirm',
      blockPrivateNetworks: values.FRONT_BURNER_BLOCK_PRIVATE_NETWORKS,
      authTokenTtlMs: values.FRONT_BURNER_AUTH_TOKEN_TTL,
      refreshTokenTtlMs: values.FRONT_BURNER_REFRESH_TOKEN_TTL,
      loginAuditRetentionMs: values.FRONT_BURNER_LOGIN_AUDIT_RETENTION,
      oidc
    },
    warnings
  };
}
