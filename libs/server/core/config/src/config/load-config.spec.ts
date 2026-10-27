import { ConfigError, loadConfig } from './load-config';

const TOKEN = 'abcdefghijklmnop';
const SECRET = 'jwt-secret-for-the-config-tests-0123456789abcdef';
const KEY = 'encryption-key-for-the-config-tests-0123456789ab';
const BASE = { FRONT_BURNER_JWT_SECRET: SECRET, FRONT_BURNER_ENCRYPTION_KEY: KEY };

function issuesOf(env: Record<string, string | undefined>, options = {}) {
  try {
    loadConfig({ ...BASE, ...env }, options);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as ConfigError).issues;
  }
  throw new Error('loadConfig did not throw');
}

describe('loadConfig', () => {
  it('keeps the warnings in the error', () => {
    try {
      loadConfig({ ...BASE, FRONT_BURNER_PORT: 'x', FRONT_BURNER_PROT: '1' });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).issues.map(i => i.variable)).toEqual([ 'FRONT_BURNER_PORT' ]);
      expect((error as ConfigError).warnings).toEqual([ 'Unknown variable FRONT_BURNER_PROT is ignored.' ]);
      return;
    }
    throw new Error('loadConfig did not throw');
  });

  it('uses the defaults', () => {
    const { config, warnings } = loadConfig(BASE);
    expect(config).toEqual({
      port: 8080,
      trustedProxies: [ 'loopback', 'linklocal', 'uniquelocal' ],
      logLevel: 'info',
      logFormat: 'json',
      dataDir: '/data',
      setupToken: undefined,
      jwtSecret: SECRET,
      encryptionKey: KEY,
      encryptionKeyReset: false,
      blockPrivateNetworks: false,
      authTokenTtlMs: 900_000,
      refreshTokenTtlMs: 2_592_000_000,
      loginAuditRetentionMs: 7_776_000_000,
      cloneTimeoutMs: 1_800_000,
      cloneConcurrency: 2,
      gitTimeoutMs: 300_000,
      knownHostsFile: undefined,
      oidc: undefined
    });
    expect(warnings).toEqual([]);
  });

  it('requires FRONT_BURNER_JWT_SECRET', () => {
    expect(issuesOf({ FRONT_BURNER_JWT_SECRET: undefined })).toEqual([
      { variable: 'FRONT_BURNER_JWT_SECRET', message: 'is required' }
    ]);
  });

  it('refuses a JWT secret shorter than 32 characters', () => {
    const short = SECRET.slice(0, 31);
    const issues = issuesOf({ FRONT_BURNER_JWT_SECRET: short });
    expect(issues).toEqual([
      { variable: 'FRONT_BURNER_JWT_SECRET', message: 'must be at least 32 characters' }
    ]);
    expect(JSON.stringify(issues)).not.toContain(short);
  });

  it('reads the JWT secret from a file', () => {
    const readFile = vi.fn().mockReturnValue(`${SECRET}\n`);
    const { config } = loadConfig(
      { FRONT_BURNER_JWT_SECRET_FILE: '/run/secrets/jwt', FRONT_BURNER_ENCRYPTION_KEY: KEY },
      { readFile }
    );
    expect(config.jwtSecret).toBe(SECRET);
    expect(readFile).toHaveBeenCalledWith('/run/secrets/jwt');
  });

  it('rejects both the JWT secret and its _FILE variant', () => {
    const issues = issuesOf({ FRONT_BURNER_JWT_SECRET_FILE: '/run/secrets/jwt' }, { readFile: () => SECRET });
    expect(issues.map(issue => issue.variable)).toEqual([ 'FRONT_BURNER_JWT_SECRET' ]);
  });

  it('requires the encryption key', () => {
    expect(issuesOf({ FRONT_BURNER_ENCRYPTION_KEY: undefined })).toEqual([
      { variable: 'FRONT_BURNER_ENCRYPTION_KEY', message: 'is required' }
    ]);
  });

  it('refuses a key shorter than 32 characters', () => {
    const short = KEY.slice(0, 31);
    const issues = issuesOf({ FRONT_BURNER_ENCRYPTION_KEY: short });
    expect(issues).toEqual([
      { variable: 'FRONT_BURNER_ENCRYPTION_KEY', message: 'must be at least 32 characters' }
    ]);
    expect(JSON.stringify(issues)).not.toContain(short);
  });

  it('refuses a key equal to the JWT secret', () => {
    const issues = issuesOf({ FRONT_BURNER_ENCRYPTION_KEY: SECRET });
    expect(issues).toEqual([
      { variable: 'FRONT_BURNER_ENCRYPTION_KEY', message: 'must differ from FRONT_BURNER_JWT_SECRET' }
    ]);
    expect(JSON.stringify(issues)).not.toContain(SECRET);
  });

  it('reads the key from a file', () => {
    const readFile = vi.fn().mockReturnValue(`${KEY}\n`);
    const { config } = loadConfig(
      { FRONT_BURNER_JWT_SECRET: SECRET, FRONT_BURNER_ENCRYPTION_KEY_FILE: '/run/secrets/key' },
      { readFile }
    );
    expect(config.encryptionKey).toBe(KEY);
    expect(readFile).toHaveBeenCalledWith('/run/secrets/key');
  });

  it('accepts only confirm as a reset', () => {
    expect(loadConfig({ ...BASE, FRONT_BURNER_ENCRYPTION_KEY_RESET: 'confirm' }).config.encryptionKeyReset)
      .toBe(true);
    expect(issuesOf({ FRONT_BURNER_ENCRYPTION_KEY_RESET: 'yes' })).toEqual([
      { variable: 'FRONT_BURNER_ENCRYPTION_KEY_RESET', message: 'must be confirm' }
    ]);
  });

  it('parses the private network switch', () => {
    const switchOf = (value: string | undefined) =>
      loadConfig({ ...BASE, FRONT_BURNER_BLOCK_PRIVATE_NETWORKS: value }).config.blockPrivateNetworks;
    expect(switchOf('true')).toBe(true);
    expect(switchOf('false')).toBe(false);
    expect(switchOf(undefined)).toBe(false);
    expect(issuesOf({ FRONT_BURNER_BLOCK_PRIVATE_NETWORKS: '1' })).toEqual([
      { variable: 'FRONT_BURNER_BLOCK_PRIVATE_NETWORKS', message: 'must be true or false' }
    ]);
  });

  it('parses the durations', () => {
    const { config } = loadConfig({
      ...BASE,
      FRONT_BURNER_AUTH_TOKEN_TTL: '5m',
      FRONT_BURNER_REFRESH_TOKEN_TTL: '7d',
      FRONT_BURNER_LOGIN_AUDIT_RETENTION: '30d',
      FRONT_BURNER_CLONE_TIMEOUT: '2h',
      FRONT_BURNER_GIT_TIMEOUT: '90s'
    });
    expect(config.authTokenTtlMs).toBe(300_000);
    expect(config.refreshTokenTtlMs).toBe(604_800_000);
    expect(config.loginAuditRetentionMs).toBe(2_592_000_000);
    expect(config.cloneTimeoutMs).toBe(7_200_000);
    expect(config.gitTimeoutMs).toBe(90_000);
  });

  it('reads the clone concurrency', () => {
    expect(loadConfig({ ...BASE, FRONT_BURNER_CLONE_CONCURRENCY: '16' }).config.cloneConcurrency).toBe(16);
  });

  it('refuses a clone concurrency outside 1 to 16', () => {
    for (const value of [ '0', '17', '2.5', 'two' ]) {
      expect(issuesOf({ FRONT_BURNER_CLONE_CONCURRENCY: value })).toEqual([
        { variable: 'FRONT_BURNER_CLONE_CONCURRENCY', message: 'must be an integer from 1 to 16' }
      ]);
    }
  });

  it('refuses an unreadable duration', () => {
    expect(issuesOf({ FRONT_BURNER_REFRESH_TOKEN_TTL: '30 days' })).toEqual([
      { variable: 'FRONT_BURNER_REFRESH_TOKEN_TTL', message: 'must be a number followed by s, m, h or d' }
    ]);
  });

  it('reads valid values', () => {
    const { config } = loadConfig({
      ...BASE,
      FRONT_BURNER_PORT: '3000',
      FRONT_BURNER_TRUSTED_PROXIES: ' 10.0.0.0/8 , loopback ',
      FRONT_BURNER_LOG_LEVEL: 'debug',
      FRONT_BURNER_LOG_FORMAT: 'pretty',
      FRONT_BURNER_SETUP_TOKEN: TOKEN
    });
    expect(config).toMatchObject({
      port: 3000,
      trustedProxies: [ '10.0.0.0/8', 'loopback' ],
      logLevel: 'debug',
      logFormat: 'pretty',
      setupToken: TOKEN
    });
  });

  it('resolves a relative data directory against the working directory', () => {
    const { config } = loadConfig({ ...BASE, FRONT_BURNER_DATA_DIR: 'tmp/data' }, { cwd: '/work' });
    expect(config.dataDir).toBe('/work/tmp/data');
  });

  it('resolves the known hosts file against the working directory', () => {
    const { config } = loadConfig({ ...BASE, FRONT_BURNER_KNOWN_HOSTS_FILE: 'etc/known_hosts' }, { cwd: '/work' });
    expect(config.knownHostsFile).toBe('/work/etc/known_hosts');
  });

  it('reports every invalid variable', () => {
    const issues = issuesOf({ FRONT_BURNER_PORT: 'abc', FRONT_BURNER_LOG_LEVEL: 'loud' });
    expect(issues.map(issue => issue.variable).sort()).toEqual([
      'FRONT_BURNER_LOG_LEVEL',
      'FRONT_BURNER_PORT'
    ]);
  });

  it.each([ '0', '65536', '-1', '80.5' ])('rejects a port of %s', port => {
    expect(issuesOf({ FRONT_BURNER_PORT: port }).map(issue => issue.variable)).toEqual([
      'FRONT_BURNER_PORT'
    ]);
  });

  it('rejects an invalid trusted proxy', () => {
    const issues = issuesOf({ FRONT_BURNER_TRUSTED_PROXIES: 'loopback, not-an-ip' });
    expect(issues.map(issue => issue.variable)).toEqual([ 'FRONT_BURNER_TRUSTED_PROXIES' ]);
  });

  it('reads the setup token from a _FILE variable', () => {
    const readFile = vi.fn().mockReturnValue(TOKEN);
    const { config } = loadConfig({ ...BASE, FRONT_BURNER_SETUP_TOKEN_FILE: '/run/secrets/token' }, { readFile });
    expect(config.setupToken).toBe(TOKEN);
    expect(readFile).toHaveBeenCalledWith('/run/secrets/token');
  });

  it.each([ '\n', '\r\n' ])('strips one trailing newline from a _FILE value (%j)', newline => {
    const { config } = loadConfig(
      { ...BASE, FRONT_BURNER_SETUP_TOKEN_FILE: '/run/secrets/token' },
      { readFile: () => TOKEN + newline }
    );
    expect(config.setupToken).toBe(TOKEN);
  });

  it('rejects both the variable and its _FILE variant', () => {
    const issues = issuesOf(
      { FRONT_BURNER_SETUP_TOKEN: TOKEN, FRONT_BURNER_SETUP_TOKEN_FILE: '/run/secrets/token' },
      { readFile: () => TOKEN }
    );
    expect(issues.map(issue => issue.variable)).toEqual([ 'FRONT_BURNER_SETUP_TOKEN' ]);
  });

  it('reports an unreadable _FILE', () => {
    const issues = issuesOf(
      { FRONT_BURNER_SETUP_TOKEN_FILE: '/run/secrets/token' },
      {
        readFile: () => {
          throw new Error('ENOENT: /run/secrets/token');
        }
      }
    );
    expect(issues.map(issue => issue.variable)).toEqual([ 'FRONT_BURNER_SETUP_TOKEN_FILE' ]);
    expect(JSON.stringify(issues)).not.toContain('/run/secrets/token');
  });

  it('ignores a short setup token with a warning', () => {
    const short = loadConfig({ ...BASE, FRONT_BURNER_SETUP_TOKEN: TOKEN.slice(1) });
    expect(short.config.setupToken).toBeUndefined();
    expect(short.warnings).toHaveLength(1);
    expect(short.warnings[0]).toContain('FRONT_BURNER_SETUP_TOKEN');

    const enough = loadConfig({ ...BASE, FRONT_BURNER_SETUP_TOKEN: TOKEN });
    expect(enough.config.setupToken).toBe(TOKEN);
    expect(enough.warnings).toEqual([]);
  });

  it('keeps a setup token with whitespace at an end, with a warning', () => {
    // The onboarding page's password field cannot send a line break.
    for (const token of [ `${TOKEN}\n`, ` ${TOKEN}`, `${TOKEN}\t` ]) {
      const { config, warnings } = loadConfig({ ...BASE, FRONT_BURNER_SETUP_TOKEN: token });
      expect(config.setupToken).toBe(token);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('FRONT_BURNER_SETUP_TOKEN');
      expect(warnings[0]).toContain('whitespace');
      expect(warnings[0]).not.toContain(TOKEN);
    }
  });

  it('never puts a secret in an issue or warning', () => {
    const secret = 'short-secret';
    const { warnings } = loadConfig({ ...BASE, FRONT_BURNER_SETUP_TOKEN: secret });
    expect(warnings.join('\n')).not.toContain(secret);

    const issues = issuesOf({ FRONT_BURNER_SETUP_TOKEN: secret, FRONT_BURNER_SETUP_TOKEN_FILE: secret });
    expect(JSON.stringify(issues)).not.toContain(secret);
  });

  it('warns about unknown FRONT_BURNER_ variables', () => {
    const { warnings } = loadConfig({ ...BASE, FRONT_BURNER_PROT: '1', PATH: '/bin', OTHER: 'x' });
    expect(warnings).toEqual([ 'Unknown variable FRONT_BURNER_PROT is ignored.' ]);
  });
  describe('OIDC', () => {
    const CLIENT_SECRET = 'oidc-client-secret-0123456789';
    const OIDC = {
      FRONT_BURNER_OIDC_ISSUER: 'https://id.example.com/realms/main',
      FRONT_BURNER_OIDC_CLIENT_ID: 'front-burner',
      FRONT_BURNER_OIDC_CLIENT_SECRET: CLIENT_SECRET,
      FRONT_BURNER_ADMIN_EMAIL: 'admin@example.com'
    };

    it('leaves OIDC unset without variables', () => {
      expect(loadConfig(BASE).config.oidc).toBeUndefined();
    });

    it('reads a full OIDC configuration', () => {
      expect(loadConfig({ ...BASE, ...OIDC }).config.oidc).toEqual({
        issuer: 'https://id.example.com/realms/main',
        clientId: 'front-burner',
        clientSecret: CLIENT_SECRET,
        scopes: 'openid email profile',
        requireVerifiedEmail: true,
        adminEmail: 'admin@example.com'
      });
      const { config } = loadConfig({
        ...BASE,
        ...OIDC,
        FRONT_BURNER_OIDC_SCOPES: 'openid email',
        FRONT_BURNER_OIDC_REQUIRE_VERIFIED_EMAIL: 'false'
      });
      expect(config.oidc?.scopes).toBe('openid email');
      expect(config.oidc?.requireVerifiedEmail).toBe(false);
    });

    it('names every missing variable', () => {
      expect(issuesOf({ FRONT_BURNER_OIDC_ISSUER: OIDC.FRONT_BURNER_OIDC_ISSUER })).toEqual([
        'FRONT_BURNER_OIDC_CLIENT_ID',
        'FRONT_BURNER_OIDC_CLIENT_SECRET',
        'FRONT_BURNER_ADMIN_EMAIL'
      ].map(variable => ({ variable, message: 'is required when other FRONT_BURNER_OIDC_* variables are set' })));
    });

    it('refuses the admin email alone', () => {
      expect(issuesOf({ FRONT_BURNER_ADMIN_EMAIL: 'admin@example.com' }).map(issue => issue.variable)).toEqual([
        'FRONT_BURNER_OIDC_ISSUER',
        'FRONT_BURNER_OIDC_CLIENT_ID',
        'FRONT_BURNER_OIDC_CLIENT_SECRET'
      ]);
    });

    it('refuses an http issuer', () => {
      for (
        const issuer of [ 'http://id.example.com', 'https://id.example.com/?a=1', 'https://id.example.com/#x', 'id' ]
      ) {
        expect(issuesOf({ ...OIDC, FRONT_BURNER_OIDC_ISSUER: issuer }).map(issue => issue.variable)).toEqual([
          'FRONT_BURNER_OIDC_ISSUER'
        ]);
      }
    });

    it('refuses an invalid admin email or flag', () => {
      expect(issuesOf({ ...OIDC, FRONT_BURNER_ADMIN_EMAIL: 'admin' }).map(issue => issue.variable)).toEqual([
        'FRONT_BURNER_ADMIN_EMAIL'
      ]);
      expect(issuesOf({ ...OIDC, FRONT_BURNER_OIDC_REQUIRE_VERIFIED_EMAIL: 'yes' }).map(issue => issue.variable))
        .toEqual([ 'FRONT_BURNER_OIDC_REQUIRE_VERIFIED_EMAIL' ]);
    });

    it('reads the client secret from a file', () => {
      const readFile = vi.fn().mockReturnValue(`${CLIENT_SECRET}\n`);
      const { config } = loadConfig({
        ...BASE,
        ...OIDC,
        FRONT_BURNER_OIDC_CLIENT_SECRET: undefined,
        FRONT_BURNER_OIDC_CLIENT_SECRET_FILE: '/run/secrets/oidc'
      }, { readFile });
      expect(config.oidc?.clientSecret).toBe(CLIENT_SECRET);
      expect(readFile).toHaveBeenCalledWith('/run/secrets/oidc');
    });

    it('puts the client secret in no issue', () => {
      const issues = issuesOf({ ...OIDC, FRONT_BURNER_OIDC_ISSUER: undefined });
      expect(issues.map(issue => issue.variable)).toEqual([ 'FRONT_BURNER_OIDC_ISSUER' ]);
      expect(JSON.stringify(issues)).not.toContain(CLIENT_SECRET);
    });
  });
});
