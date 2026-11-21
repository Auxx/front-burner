import { ConfigError } from '@front-burner/server-core-config';
import { applyMigrations, DATABASE, Database, openDatabase, readLastVersion } from '@front-burner/server-core-database';
import { MIGRATIONS_FOLDER, previousMigrations } from '@front-burner/server-core-database/testing';
import type { INestApplication } from '@nestjs/common';
import BetterSqlite3 from 'better-sqlite3';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { bootstrapLoggerFor, logStartupFailure, startServer, StartupError } from './start-server';

// The real migrations: the application needs its tables.
const MIGRATIONS = MIGRATIONS_FOLDER;
const GIT_HELPERS = join(__dirname, '..', '..', '..', '..', 'libs', 'server', 'core', 'git', 'helpers');

describe('startServer', () => {
  let root: string;
  let dataDir: string;
  let webRoot: string;
  let migrationsFolder: string;
  let gitHelpersDir: string;
  let logs: string[];
  let app: INestApplication | undefined;

  const start = (env: Record<string, string | undefined> = {}, version?: string) =>
    startServer({
      version,
      env: {
        FRONT_BURNER_DATA_DIR: dataDir,
        FRONT_BURNER_LOG_FORMAT: 'json',
        FRONT_BURNER_JWT_SECRET: 'server-spec-jwt-secret-0123456789abcdefghijklm',
        FRONT_BURNER_ENCRYPTION_KEY: 'server-spec-encryption-key-0123456789abcdefghi',
        ...env
      },
      cwd: root,
      webRoot,
      migrationsFolder,
      gitHelpersDir,
      listen: false,
      logDestination: { write: (line: string) => void logs.push(line) }
    });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'fb-server-'));
    dataDir = join(root, 'data');
    webRoot = join(root, 'web');
    migrationsFolder = MIGRATIONS;
    gitHelpersDir = GIT_HELPERS;
    mkdirSync(webRoot);
    logs = [];
    app = undefined;
  });

  afterEach(async () => {
    await app?.close();
    rmSync(root, { recursive: true, force: true });
  });

  // Starts the server, whose git step runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
  it.skipIf(process.platform === 'win32')('closes the database when the application closes', async () => {
    app = await start();
    const database = app.get<Database>(DATABASE);
    expect(database.sqlite.open).toBe(true);

    await app.close();

    expect(database.sqlite.open).toBe(false);
  });

  // Starts the server, whose git step runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
  it.skipIf(process.platform === 'win32')('serves the health endpoints outside /api/v1', async () => {
    app = await start();

    const response = await request(app.getHttpServer()).get('/api/health/live');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  // Starts the server, whose git step runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
  it.skipIf(process.platform === 'win32')('prefixes other routes with /api/v1', async () => {
    app = await start();

    const response = await request(app.getHttpServer()).get('/api/v1/nope');

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('not-found');
  });

  // Starts the server, whose git step runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
  it.skipIf(process.platform === 'win32')(
    'serves metrics outside /api/v1, without a version header (NF-10.9, NF-10.10)',
    async () => {
      const token = 'metrics-token-0123456789';
      app = await start({ FRONT_BURNER_METRICS_TOKEN: token }, '1.4.2');

      const response = await request(app.getHttpServer()).get('/api/metrics').set('Authorization', `Bearer ${token}`);
      const refused = await request(app.getHttpServer()).get('/api/metrics');

      expect(response.status).toBe(200);
      expect(response.text).toContain('front_burner_');
      expect(response.headers['x-front-burner-version']).toBeUndefined();
      expect(refused.status).toBe(401);
      expect(refused.body.code).toBe('unauthenticated');
      expect(refused.headers['x-front-burner-version']).toBeUndefined();
      expect((await request(app.getHttpServer()).get('/api/v1/metrics')).status).toBe(404);
    }
  );

  // Starts the server, whose git step runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
  it.skipIf(process.platform === 'win32')(
    'answers /api/metrics like an unknown route when metrics are off',
    async () => {
      writeFileSync(join(webRoot, 'index.html'), '<html><script nonce="__CSP_NONCE__"></script></html>');
      app = await start();

      const metrics = await request(app.getHttpServer()).get('/api/metrics');
      const unknown = await request(app.getHttpServer()).get('/api/nothing-here');

      expect(metrics.status).toBe(unknown.status);
      expect(metrics.headers['content-type']).toBe(unknown.headers['content-type']);
      expect({ ...metrics.body, requestId: undefined }).toEqual({ ...unknown.body, requestId: undefined });
    }
  );

  // Starts the server, whose git step runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
  it.skipIf(process.platform === 'win32')('no Server-Timing by default', async () => {
    app = await start();

    const response = await request(app.getHttpServer()).get('/api/v1/me');

    expect(response.status).toBe(401);
    expect(response.headers['server-timing']).toBeUndefined();
  });

  // Starts the server, whose git step runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
  it.skipIf(process.platform === 'win32')(
    'with FRONT_BURNER_SERVER_TIMING, API responses carry Server-Timing, the health endpoints never',
    async () => {
      app = await start({ FRONT_BURNER_SERVER_TIMING: 'true' });

      const api = await request(app.getHttpServer()).get('/api/v1/me');
      const health = await request(app.getHttpServer()).get('/api/health/live');

      expect(api.headers['server-timing']).toMatch(/^app;dur=\d+\.\d$/);
      expect(health.headers['server-timing']).toBeUndefined();
    }
  );

  // Starts the server, whose git step runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
  it.skipIf(process.platform === 'win32')('rate-limits requests that the auth guard refuses (A-1.12)', async () => {
    app = await start();

    for (let i = 0; i < 60; i++) {
      expect((await request(app.getHttpServer()).get('/api/v1/me')).status).toBe(401);
    }
    expect((await request(app.getHttpServer()).get('/api/v1/me')).status).toBe(429);
  });

  // Starts the server, whose git step runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
  it.skipIf(process.platform === 'win32')('limits JSON bodies to 2 MB', async () => {
    app = await start();

    const response = await request(app.getHttpServer())
      .post('/api/v1/nope')
      .send({ text: 'x'.repeat(3 * 1024 * 1024) });

    expect(response.status).toBe(413);
    expect(response.body.code).toBe('payload-too-large');
  });

  const logEntries = () =>
    logs.flatMap(chunk => chunk.split('\n').filter(Boolean)).map(line => JSON.parse(line) as Record<string, any>);

  // Starts the server, whose git step runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
  it.skipIf(process.platform === 'win32')(
    'logs the request ID of a rejected oversized body (NF-10.6, A-1.12)',
    async () => {
      app = await start();

      const response = await request(app.getHttpServer())
        .post('/api/v1/nope')
        .send({ text: 'x'.repeat(3 * 1024 * 1024) });

      expect(response.status).toBe(413);
      expect(response.headers['x-request-id']).toBe(response.body.requestId);
      const completed = logEntries().filter(e =>
        e['requestId'] === response.body.requestId && e['message'] === 'request completed'
      );
      expect(completed).toHaveLength(1);
    }
  );

  // Starts the server, whose git step runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
  it.skipIf(process.platform === 'win32')('logs the request ID of malformed JSON', async () => {
    app = await start();

    const response = await request(app.getHttpServer())
      .post('/api/v1/nope')
      .set('Content-Type', 'application/json')
      .send('{ not json');

    expect(response.status).toBe(400);
    expect(logEntries().some(e => e['requestId'] === response.body.requestId && e['message'] === 'request completed'))
      .toBe(true);
  });

  // Starts the server, whose git step runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
  it.skipIf(process.platform === 'win32')(
    'gives web client pages and static assets a request ID and logs them once',
    async () => {
      writeFileSync(join(webRoot, 'index.html'), '<html><script nonce="__CSP_NONCE__"></script></html>');
      writeFileSync(join(webRoot, 'main.js'), 'console.log(1);');
      mkdirSync(join(webRoot, 'assets'));
      app = await start();

      for (const path of [ '/login', '/main.js', '/assets/missing.png' ]) {
        const response = await request(app.getHttpServer()).get(path);
        const id = response.headers['x-request-id'];
        expect(id, path).toBeTruthy();
        expect(logEntries().filter(e => e['requestId'] === id && e['message'] === 'request completed'), path)
          .toHaveLength(1);
      }
    }
  );

  // Starts the server, whose git step runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
  it.skipIf(process.platform === 'win32')('starts without a web client build', async () => {
    app = await start();

    const response = await request(app.getHttpServer()).get('/api/health/live');

    expect(response.status).toBe(200);
    expect(logs.filter(line => line.includes('serving the API only'))).toHaveLength(1);
  });

  // Starts the server, whose git step runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
  it.skipIf(process.platform === 'win32')('serves the web client when built', async () => {
    writeFileSync(join(webRoot, 'index.html'), '<html><script nonce="__CSP_NONCE__"></script></html>');
    app = await start();

    const response = await request(app.getHttpServer()).get('/login');

    expect(response.status).toBe(200);
    expect(response.headers['content-security-policy']).toContain('script-src');
    expect(logs.filter(line => line.includes('serving the API only'))).toHaveLength(0);
  });

  // Starts the server, whose git step runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
  it.skipIf(process.platform === 'win32')('keeps img-src as IM-23 says', async () => {
    writeFileSync(join(webRoot, 'index.html'), '<html><script nonce="__CSP_NONCE__"></script></html>');
    app = await start();

    const response = await request(app.getHttpServer()).get('/repositories/1');

    expect(response.headers['content-security-policy']).toContain('img-src \'self\' blob: data: https:;');
  });

  it('fails at the config step', async () => {
    const failure = await start({ FRONT_BURNER_PORT: 'abc' }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(StartupError);
    expect((failure as StartupError).step).toBe('config');
  });

  it('fails at the migrations step for a newer database', async () => {
    mkdirSync(join(dataDir, 'db'), { recursive: true });
    const sqlite = new BetterSqlite3(join(dataDir, 'db', 'front-burner.sqlite'));
    sqlite.exec('CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT, created_at NUMERIC)');
    sqlite.exec('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (\'x\', 1700000000000)');
    sqlite.close();

    const failure = await start().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(StartupError);
    expect((failure as StartupError).step).toBe('migrations');
    expect((failure as StartupError).message).toContain(
      'Database is from a newer version; restore the pre-upgrade snapshot to go back'
    );
    expect(readdirSync(join(dataDir, 'backups'))).toEqual([]);
  });

  // Starts the server, whose git step runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
  it.skipIf(process.platform === 'win32')(
    'writes a pre-upgrade snapshot and records the version on an upgrade',
    async () => {
      // A database of the previous version: every migration but the last.
      mkdirSync(join(dataDir, 'db'), { recursive: true });
      const old = openDatabase(join(dataDir, 'db', 'front-burner.sqlite'));
      applyMigrations(old, previousMigrations(root));
      old.sqlite.close();

      app = await start({}, '0.2.0');

      const snapshots = readdirSync(join(dataDir, 'backups')).filter(name => name.startsWith('pre-upgrade-'));
      expect(snapshots).toEqual([ expect.stringMatching(/^pre-upgrade-vunknown-.*\.sqlite$/) ]);
      const upgrading = logEntries().filter(e => String(e['message']).startsWith('Upgrading the database'));
      expect(upgrading).toEqual([
        expect.objectContaining({
          level: 'info',
          message: `Upgrading the database from unknown to 0.2.0; snapshot backups/${snapshots[0]}`
        })
      ]);
      expect(readLastVersion(app.get<Database>(DATABASE))).toBe('0.2.0');
    }
  );

  it('fails at the data-dir step when the data directory is a file', async () => {
    writeFileSync(dataDir, 'not a directory');

    const failure = await start().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(StartupError);
    expect((failure as StartupError).step).toBe('data-dir');
    expect((failure as StartupError).message).toContain(dataDir);
  });

  it('fails at the database step when the database file cannot be opened', async () => {
    mkdirSync(join(dataDir, 'db', 'front-burner.sqlite'), { recursive: true });

    const failure = await start().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(StartupError);
    expect((failure as StartupError).step).toBe('database');
  });

  // Starts the server, whose git step runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
  it.skipIf(process.platform === 'win32')('stops at encryption-key with another key', async () => {
    app = await start();
    await app.close();
    app = undefined;

    const failure = await start({
      FRONT_BURNER_ENCRYPTION_KEY: 'another-server-spec-encryption-key-0123456789'
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(StartupError);
    expect((failure as StartupError).step).toBe('encryption-key');
    expect((failure as StartupError).message).toContain('FRONT_BURNER_ENCRYPTION_KEY');
  });

  it('stops at git when a helper is missing', async () => {
    gitHelpersDir = join(root, 'helpers');
    mkdirSync(gitHelpersDir);

    const failure = await start().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(StartupError);
    expect((failure as StartupError).step).toBe('git');
    expect((failure as StartupError).message).toContain('askpass.cjs');
  });

  // Starts the server, whose git step runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
  it.skipIf(process.platform === 'win32')('warns about a reset that the matching key made unnecessary', async () => {
    app = await start();
    await app.close();

    app = await start({ FRONT_BURNER_ENCRYPTION_KEY_RESET: 'confirm' });

    const warnings = logEntries().filter(e => String(e['message']).includes('FRONT_BURNER_ENCRYPTION_KEY_RESET'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]['level']).toBe('warn');
  });

  // Starts the server, whose git step runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
  it.skipIf(process.platform === 'win32')(
    'logs the configuration warnings once, before Nest exists (A-1.11)',
    async () => {
      app = await start({ FRONT_BURNER_PROT: '1' });

      const warnings = logEntries().filter(e => String(e['message']).includes('FRONT_BURNER_PROT'));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]['level']).toBe('warn');
      expect(logEntries()[0]['message']).toContain('FRONT_BURNER_PROT');
    }
  );

  // Starts the server, whose git step runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
  describe.skipIf(process.platform === 'win32')('trust proxy', () => {
    const hsts = async (trusted: string) => {
      app = await start({ FRONT_BURNER_TRUSTED_PROXIES: trusted });
      const response = await request(app.getHttpServer()).get('/api/health/live').set('X-Forwarded-Proto', 'https');
      return response.headers['strict-transport-security'];
    };

    it('trusts X-Forwarded-Proto from a trusted proxy', async () => {
      expect(await hsts('loopback')).toBeDefined();
    });

    it('ignores X-Forwarded-Proto from an unrelated address', async () => {
      expect(await hsts('203.0.113.7')).toBeUndefined();
    });

    /** The statuses of 11 logins, each claiming another client address; the limit is 10 per address (LG-65). */
    const loginsFromClaimedAddresses = async (trusted: string) => {
      app = await start({ FRONT_BURNER_TRUSTED_PROXIES: trusted });
      const statuses: number[] = [];
      for (let i = 1; i <= 11; i++) {
        const response = await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .set('X-Forwarded-For', `198.51.100.${i}`)
          .send({ email: 'nobody@example.com', password: 'wrong', refreshTokenDelivery: 'body' });
        statuses.push(response.status);
      }
      return statuses;
    };

    // Security review (plan 145): a client that is not a trusted proxy cannot choose its rate limit key.
    it('ignores X-Forwarded-For from an unrelated address when counting logins', async () => {
      const statuses = await loginsFromClaimedAddresses('203.0.113.7');
      expect(statuses.slice(0, 10)).toEqual(Array(10).fill(401));
      expect(statuses[10]).toBe(429);
    });

    it('counts logins per forwarded address behind a trusted proxy', async () => {
      expect(await loginsFromClaimedAddresses('loopback')).toEqual(Array(11).fill(401));
    });
  });
});

describe('bootstrapLoggerFor', () => {
  const lines: string[] = [];
  const destination = { write: (line: string) => void lines.push(line) };

  beforeEach(() => {
    lines.length = 0;
  });

  it('honours the configured log level', () => {
    const logger = bootstrapLoggerFor(
      {
        FRONT_BURNER_LOG_LEVEL: 'error',
        FRONT_BURNER_LOG_FORMAT: 'json',
        FRONT_BURNER_JWT_SECRET: 'server-spec-jwt-secret-0123456789abcdefghijklm',
        FRONT_BURNER_ENCRYPTION_KEY: 'server-spec-encryption-key-0123456789abcdefghi'
      },
      destination
    );
    logger.warn('hidden');
    logger.fatal('shown');

    expect(lines.map(l => JSON.parse(l).message)).toEqual([ 'shown' ]);
  });

  it('falls back to JSON at info when the configuration does not parse', () => {
    const logger = bootstrapLoggerFor(
      { FRONT_BURNER_LOG_LEVEL: 'loud', FRONT_BURNER_LOG_FORMAT: 'pretty' },
      destination
    );
    logger.info('shown');

    expect(JSON.parse(lines[0]).message).toBe('shown');
  });
});

describe('logStartupFailure', () => {
  const lines: string[] = [];
  const destination = { write: (line: string) => void lines.push(line) };

  beforeEach(() => {
    lines.length = 0;
  });

  it('logs the step and the reason as a fatal line', () => {
    logStartupFailure(new StartupError('database', new Error('boom')), {}, destination);

    const entry = JSON.parse(lines[0]);
    expect(entry).toMatchObject({ level: 'fatal', step: 'database' });
    expect(entry.message).toContain('boom');
  });

  it('also prints the configuration warnings of a failed configuration', () => {
    const cause = new ConfigError([ { variable: 'FRONT_BURNER_PORT', message: 'bad' } ], [
      'Unknown variable X is ignored.'
    ]);

    logStartupFailure(new StartupError('config', cause), { FRONT_BURNER_PORT: 'x' }, destination);

    const entries = lines.map(l => JSON.parse(l));
    expect(entries.map(e => e.level)).toEqual([ 'warn', 'fatal' ]);
    expect(entries[0].message).toBe('Unknown variable X is ignored.');
  });

  it('logs other errors as a startup failure', () => {
    logStartupFailure(new Error('odd'), {}, destination);

    expect(JSON.parse(lines[0]).message).toBe('Startup failed');
  });
});
