import { DATABASE, Database } from '@front-burner/server-core-database';
import type { INestApplication } from '@nestjs/common';
import BetterSqlite3 from 'better-sqlite3';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { startServer, StartupError } from './start-server';

describe('startServer', () => {
  let root: string;
  let dataDir: string;
  let webRoot: string;
  let migrationsFolder: string;
  let logs: string[];
  let app: INestApplication | undefined;

  const start = (env: Record<string, string | undefined> = {}) =>
    startServer({
      env: { FRONT_BURNER_DATA_DIR: dataDir, FRONT_BURNER_LOG_FORMAT: 'json', ...env },
      cwd: root,
      webRoot,
      migrationsFolder,
      listen: false,
      logDestination: { write: (line: string) => void logs.push(line) }
    });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'fb-server-'));
    dataDir = join(root, 'data');
    webRoot = join(root, 'web');
    migrationsFolder = join(root, 'migrations');
    mkdirSync(webRoot);
    mkdirSync(migrationsFolder);
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
});
