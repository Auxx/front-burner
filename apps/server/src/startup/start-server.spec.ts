import { ConfigError } from '@front-burner/server-core-config';
import { DATABASE, Database } from '@front-burner/server-core-database';
import type { INestApplication } from '@nestjs/common';
import BetterSqlite3 from 'better-sqlite3';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { bootstrapLoggerFor, logStartupFailure, startServer, StartupError } from './start-server';

// The real migrations: the application needs its tables.
const MIGRATIONS = join(__dirname, '..', '..', '..', '..', 'libs', 'server', 'core', 'database', 'migrations');
const GIT_HELPERS = join(__dirname, '..', '..', '..', '..', 'libs', 'server', 'core', 'git', 'helpers');

describe('startServer', () => {
  let root: string;
  let dataDir: string;
  let webRoot: string;
  let migrationsFolder: string;
  let gitHelpersDir: string;
  let logs: string[];
  let app: INestApplication | undefined;

  const start = (env: Record<string, string | undefined> = {}) =>
    startServer({
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

  it('closes the database when the application closes', async () => {
    app = await start();
    const database = app.get<Database>(DATABASE);
    expect(database.sqlite.open).toBe(true);

    await app.close();

    expect(database.sqlite.open).toBe(false);
  });

  it('serves the health endpoints outside /api/v1', async () => {
    app = await start();

    const response = await request(app.getHttpServer()).get('/api/health/live');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('prefixes other routes with /api/v1', async () => {
    app = await start();

    const response = await request(app.getHttpServer()).get('/api/v1/nope');

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('not-found');
  });

  it('rate-limits requests that the auth guard refuses (A-1.12)', async () => {
    app = await start();

    for (let i = 0; i < 60; i++) {
      expect((await request(app.getHttpServer()).get('/api/v1/me')).status).toBe(401);
    }
    expect((await request(app.getHttpServer()).get('/api/v1/me')).status).toBe(429);
  });

  it('limits JSON bodies to 2 MB', async () => {
    app = await start();

    const response = await request(app.getHttpServer())
      .post('/api/v1/nope')
      .send({ text: 'x'.repeat(3 * 1024 * 1024) });

    expect(response.status).toBe(413);
    expect(response.body.code).toBe('payload-too-large');
  });

  const logEntries = () =>
    logs.flatMap(chunk => chunk.split('\n').filter(Boolean)).map(line => JSON.parse(line) as Record<string, any>);

  it('logs the request ID of a rejected oversized body (NF-10.6, A-1.12)', async () => {
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
  });

  it('logs the request ID of malformed JSON', async () => {
    app = await start();

    const response = await request(app.getHttpServer())
      .post('/api/v1/nope')
      .set('Content-Type', 'application/json')
      .send('{ not json');

    expect(response.status).toBe(400);
    expect(logEntries().some(e => e['requestId'] === response.body.requestId && e['message'] === 'request completed'))
      .toBe(true);
  });

  it('gives web client pages and static assets a request ID and logs them once', async () => {
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
  });

  it('starts without a web client build', async () => {
    app = await start();

    const response = await request(app.getHttpServer()).get('/api/health/live');

    expect(response.status).toBe(200);
    expect(logs.filter(line => line.includes('serving the API only'))).toHaveLength(1);
  });

  it('serves the web client when built', async () => {
    writeFileSync(join(webRoot, 'index.html'), '<html><script nonce="__CSP_NONCE__"></script></html>');
    app = await start();

    const response = await request(app.getHttpServer()).get('/login');

    expect(response.status).toBe(200);
    expect(response.headers['content-security-policy']).toContain('script-src');
    expect(logs.filter(line => line.includes('serving the API only'))).toHaveLength(0);
  });

  it('keeps img-src as IM-23 says', async () => {
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
  });

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

  it('stops at encryption-key with another key', async () => {
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

  it('warns about a reset that the matching key made unnecessary', async () => {
    app = await start();
    await app.close();

    app = await start({ FRONT_BURNER_ENCRYPTION_KEY_RESET: 'confirm' });

    const warnings = logEntries().filter(e => String(e['message']).includes('FRONT_BURNER_ENCRYPTION_KEY_RESET'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]['level']).toBe('warn');
  });

  it('logs the configuration warnings once, before Nest exists (A-1.11)', async () => {
    app = await start({ FRONT_BURNER_PROT: '1' });

    const warnings = logEntries().filter(e => String(e['message']).includes('FRONT_BURNER_PROT'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]['level']).toBe('warn');
    expect(logEntries()[0]['message']).toContain('FRONT_BURNER_PROT');
  });

  describe('trust proxy', () => {
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
