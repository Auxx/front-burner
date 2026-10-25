import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compile } from 'proxy-addr';
import { z } from 'zod';
import { Config } from './config.model';

const PREFIX = 'FRONT_BURNER_';
const SETUP_TOKEN = 'FRONT_BURNER_SETUP_TOKEN';
const SETUP_TOKEN_FILE = 'FRONT_BURNER_SETUP_TOKEN_FILE';
const MIN_SETUP_TOKEN_LENGTH = 16;
const DEFAULT_TRUSTED_PROXIES = 'loopback, linklocal, uniquelocal';

export interface ConfigIssue {
  variable: string;
  message: string;
}

/** Thrown with every invalid variable. Messages never contain a secret value. */
export class ConfigError extends Error {
  constructor(readonly issues: ConfigIssue[]) {
    super(
      `Invalid configuration:\n${issues.map(issue => `- ${issue.variable}: ${issue.message}`).join('\n')}`
    );
    this.name = 'ConfigError';
  }
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
  [SETUP_TOKEN_FILE]: z.string().optional()
}).refine(v => v[SETUP_TOKEN] === undefined || v[SETUP_TOKEN_FILE] === undefined, {
  path: [ SETUP_TOKEN ],
  message: `cannot be set together with ${SETUP_TOKEN_FILE}`
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

  let setupToken: string | undefined = input[SETUP_TOKEN];
  let tokenVariable = SETUP_TOKEN;
  const tokenFile = input[SETUP_TOKEN_FILE];
  if (tokenFile !== undefined && setupToken === undefined) {
    tokenVariable = SETUP_TOKEN_FILE;
    try {
      setupToken = readFile(tokenFile).replace(/\r?\n$/, '');
    } catch {
      issues.push({ variable: SETUP_TOKEN_FILE, message: 'the file could not be read' });
    }
  }
  if (setupToken !== undefined && setupToken.length < MIN_SETUP_TOKEN_LENGTH) {
    warnings.push(
      `${tokenVariable} gives a setup token shorter than ${MIN_SETUP_TOKEN_LENGTH} characters; it is ignored.`
    );
    setupToken = undefined;
  }

  if (!parsed.success || issues.length > 0) {
    throw new ConfigError(issues);
  }

  const values = parsed.data;
  return {
    config: {
      port: values.FRONT_BURNER_PORT,
      trustedProxies: values.FRONT_BURNER_TRUSTED_PROXIES,
      logLevel: values.FRONT_BURNER_LOG_LEVEL,
      logFormat: values.FRONT_BURNER_LOG_FORMAT,
      dataDir: resolve(cwd, values.FRONT_BURNER_DATA_DIR),
      setupToken
    },
    warnings
  };
}
