import { ConfigError, loadConfig } from './load-config';

const TOKEN = 'abcdefghijklmnop';

function issuesOf(env: Record<string, string | undefined>, options = {}) {
  try {
    loadConfig(env, options);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as ConfigError).issues;
  }
  throw new Error('loadConfig did not throw');
}

describe('loadConfig', () => {
  it('keeps the warnings in the error', () => {
    try {
      loadConfig({ FRONT_BURNER_PORT: 'x', FRONT_BURNER_PROT: '1' });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).issues.map(i => i.variable)).toEqual([ 'FRONT_BURNER_PORT' ]);
      expect((error as ConfigError).warnings).toEqual([ 'Unknown variable FRONT_BURNER_PROT is ignored.' ]);
      return;
    }
    throw new Error('loadConfig did not throw');
  });

  it('uses the defaults', () => {
    const { config, warnings } = loadConfig({});
    expect(config).toEqual({
      port: 8080,
      trustedProxies: [ 'loopback', 'linklocal', 'uniquelocal' ],
      logLevel: 'info',
      logFormat: 'json',
      dataDir: '/data',
      setupToken: undefined
    });
    expect(warnings).toEqual([]);
  });

  it('reads valid values', () => {
    const { config } = loadConfig({
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
    const { config } = loadConfig({ FRONT_BURNER_DATA_DIR: 'tmp/data' }, { cwd: '/work' });
    expect(config.dataDir).toBe('/work/tmp/data');
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
    const { config } = loadConfig({ FRONT_BURNER_SETUP_TOKEN_FILE: '/run/secrets/token' }, { readFile });
    expect(config.setupToken).toBe(TOKEN);
    expect(readFile).toHaveBeenCalledWith('/run/secrets/token');
  });

  it.each([ '\n', '\r\n' ])('strips one trailing newline from a _FILE value (%j)', newline => {
    const { config } = loadConfig(
      { FRONT_BURNER_SETUP_TOKEN_FILE: '/run/secrets/token' },
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
    const short = loadConfig({ FRONT_BURNER_SETUP_TOKEN: TOKEN.slice(1) });
    expect(short.config.setupToken).toBeUndefined();
    expect(short.warnings).toHaveLength(1);
    expect(short.warnings[0]).toContain('FRONT_BURNER_SETUP_TOKEN');

    const enough = loadConfig({ FRONT_BURNER_SETUP_TOKEN: TOKEN });
    expect(enough.config.setupToken).toBe(TOKEN);
    expect(enough.warnings).toEqual([]);
  });

  it('never puts a secret in an issue or warning', () => {
    const secret = 'short-secret';
    const { warnings } = loadConfig({ FRONT_BURNER_SETUP_TOKEN: secret });
    expect(warnings.join('\n')).not.toContain(secret);

    const issues = issuesOf({ FRONT_BURNER_SETUP_TOKEN: secret, FRONT_BURNER_SETUP_TOKEN_FILE: secret });
    expect(JSON.stringify(issues)).not.toContain(secret);
  });

  it('warns about unknown FRONT_BURNER_ variables', () => {
    const { warnings } = loadConfig({ FRONT_BURNER_PROT: '1', PATH: '/bin', OTHER: 'x' });
    expect(warnings).toEqual([ 'Unknown variable FRONT_BURNER_PROT is ignored.' ]);
  });
});
