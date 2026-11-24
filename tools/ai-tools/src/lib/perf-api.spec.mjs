import BetterSqlite3 from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createRemote,
  fillDataDir,
  git,
  markdownOf,
  parseMeasures,
  scaleUserEmail,
  Session,
  startGitServer,
  thinkPause,
  timedGit
} from './perf-api.mjs';
import { WORKSPACE_ROOT } from './workspace.mjs';

let dir;

beforeEach(() => {
  mkdirSync(join(WORKSPACE_ROOT, 'tmp'), { recursive: true });
  dir = mkdtempSync(join(WORKSPACE_ROOT, 'tmp', 'perf-api-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('parseMeasures', () => {
  it('picks measures by name, all by default, and refuses others', () => {
    expect(parseMeasures(undefined)).toEqual(new Set([ 'folder', 'file', 'save', 'push', 'pull' ]));
    expect(parseMeasures('pull, folder')).toEqual(new Set([ 'pull', 'folder' ]));
    expect(() => parseMeasures('folder,status')).toThrow(/--measures/);
    expect(() => parseMeasures(',')).toThrow(/--measures/);
  });
});

describe('thinkPause', () => {
  it('is between half and one and a half times the mean, and none without one', () => {
    expect(thinkPause(5000, () => 0)).toBe(2500);
    expect(thinkPause(5000, () => 0.5)).toBe(5000);
    expect(thinkPause(5000, () => 0.999)).toBeCloseTo(7495);
    expect(thinkPause(0, () => 0.5)).toBe(0);
  });
});

describe('markdownOf', () => {
  it('is Markdown of the size asked for, the same every time', () => {
    const text = markdownOf(100 * 1024);
    expect(text.length).toBe(100 * 1024);
    expect(text.startsWith('# Big file\n\n## Section 1\n')).toBe(true);
    expect(text.endsWith('\n')).toBe(true);
    expect(markdownOf(100 * 1024)).toBe(text);
  });
});

describe('createRemote and startGitServer', () => {
  it('serves the fixtures over HTTPS with the test certificate, pushes included', async () => {
    const { clones } = createRemote(dir, 'fixture');
    const server = await startGitServer(join(dir, 'remotes'));
    try {
      // git without blocking: the server runs in this process.
      const clone = join(clones, 'check');
      await timedGit(clones, 'clone', '-q', `${server.url}/fixture.git`, clone);
      expect(readdirSync(join(clone, 'many'))).toHaveLength(1000);
      expect(readdirSync(clone).sort()).toEqual([ '.git', 'big.md', 'many', 'pulled.md', 'pushed.md', 'saved.md' ]);

      writeFileSync(join(clone, 'pushed.md'), '# Pushed again\n');
      git(clone, 'commit', '-q', '-am', 'Again');
      await timedGit(clone, 'push', '-q');
      expect(git(join(dir, 'remotes', 'fixture.git'), 'log', '-1', '--format=%s')).toBe('Again');

      await expect(timedGit(clones, 'clone', '-q', `${server.url}/missing.git`, join(clones, 'missing'))).rejects
        .toThrow(/clone failed/);
    } finally {
      await server.close();
    }
  });

  it('refuses a remote that exists already', () => {
    createRemote(dir, 'twice');
    expect(() => createRemote(dir, 'twice')).toThrow(/exists already/);
  });
});

describe('fillDataDir', () => {
  const databaseFile = () => join(dir, 'db', 'front-burner.sqlite');

  /** The columns `fillDataDir` writes, as the real migrations name them. */
  function createDatabase(users = 1) {
    mkdirSync(join(dir, 'db'));
    const sqlite = new BetterSqlite3(databaseFile());
    sqlite.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT UNIQUE, display_name TEXT, role TEXT,
        login_method TEXT, password_hash TEXT, created_at INTEGER);
      CREATE TABLE user_preferences (user_id INTEGER PRIMARY KEY, commit_author_name TEXT,
        commit_author_email TEXT, commit_author_confirmed INTEGER);
      CREATE TABLE repositories (id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, remote_url TEXT,
        clone_mode TEXT, branch TEXT, git_level TEXT, status TEXT, error_code TEXT, error_detail TEXT,
        error_request_id TEXT, created_at INTEGER, last_accessed_at INTEGER);
    `);
    for (let i = 1; i <= users; i++) {
      sqlite.prepare(
        `INSERT INTO users (email, display_name, role, login_method, password_hash, created_at)
         VALUES (?, 'A', 'admin', 'password', 'hash', 0)`
      ).run(`admin${i}@example.com`);
    }
    sqlite.close();
  }

  it('adds users with the administrator\'s password and a working copy per repository', () => {
    createDatabase();

    expect(fillDataDir(dir, { users: 2, repositories: 3 })).toEqual({ users: 3, workingCopies: 9 });

    const sqlite = new BetterSqlite3(databaseFile(), { readonly: true });
    const users = sqlite.prepare('SELECT id, email, password_hash FROM users ORDER BY id').all();
    const repositories = sqlite.prepare('SELECT id, user_id, name, status FROM repositories ORDER BY id').all();
    sqlite.close();
    expect(users.map(u => [ u.email, u.password_hash ])).toEqual([
      [ 'admin1@example.com', 'hash' ],
      [ scaleUserEmail(1), 'hash' ],
      [ scaleUserEmail(2), 'hash' ]
    ]);
    expect(repositories).toHaveLength(9);
    expect(new Set(repositories.map(r => r.status))).toEqual(new Set([ 'ready' ]));
    for (const { id, user_id: userId } of repositories) {
      const workingCopy = join(dir, 'repos', String(userId), String(id));
      expect(git(workingCopy, 'remote', 'get-url', 'origin')).toBe('https://git.example.invalid/perf/scale.git');
      expect(git(workingCopy, 'status', '--porcelain')).toBe('');
    }
    expect(existsSync(join(dir, 'tmp', 'perf-template'))).toBe(false);
  });

  it('refuses an instance with other users, or one that is running, or none at all', () => {
    expect(() => fillDataDir(dir)).toThrow(/No database/);
    createDatabase(2);
    expect(() => fillDataDir(dir, { users: 1, repositories: 1 })).toThrow(/2 users/);
    writeFileSync(`${databaseFile()}-shm`, '');
    expect(() => fillDataDir(dir, { users: 1, repositories: 1 })).toThrow(/stop the instance/);
  });
});

/**
 * A fake instance: login, refresh tokens that work once, `/me`, the push
 * channel (`events: 'ok'` or a status to refuse it with), and push jobs, the
 * first of which (`limitFirstPush`) is answered 429 for a second.
 */
async function fakeInstance({ events = 'ok', limitFirstPush = false } = {}) {
  const state = { refreshes: 0, used: new Set(), streams: new Set(), jobs: 0 };
  let token = 0;
  const tokens = () => {
    token++;
    return {
      authToken: `auth-${token}`,
      refreshToken: `refresh-${token}`,
      // Expired at once, so that the next call refreshes.
      authTokenExpiresAt: new Date(Date.now() - 1000).toISOString()
    };
  };
  const json = (response, status, body) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  };
  const server = createHttpServer(async (request, response) => {
    let text = '';
    for await (const chunk of request) {
      text += chunk;
    }
    const path = request.url;
    if (path === '/api/v1/auth/login') {
      json(response, 200, tokens());
    } else if (path === '/api/v1/auth/session/refresh') {
      const { refreshToken } = JSON.parse(text);
      if (state.used.has(refreshToken)) {
        json(response, 401, { code: 'session-revoked' });
        return;
      }
      state.used.add(refreshToken);
      state.refreshes++;
      // A slow refresh, so that callers at once overlap.
      await new Promise(resolve => setTimeout(resolve, 50));
      json(response, 200, tokens());
    } else if (path === '/api/v1/me') {
      json(response, 200, {});
    } else if (path === '/api/v1/events') {
      if (events !== 'ok') {
        json(response, events, { code: 'refused' });
        return;
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(': connected\n\n');
      state.streams.add(response);
      response.on('close', () => state.streams.delete(response));
    } else if (path === '/api/v1/repositories/1/git/push') {
      if (limitFirstPush && state.jobs === 0) {
        state.jobs++;
        response.writeHead(429, { 'retry-after': '1' });
        response.end();
        return;
      }
      const jobId = ++state.jobs;
      json(response, 202, { jobId });
      setTimeout(() => {
        for (const stream of state.streams) {
          stream.write(`event: job.finished\ndata: {"jobId":${jobId}}\n\n`);
        }
      }, 50);
    } else if (path.startsWith('/api/v1/repositories/1/git/jobs/')) {
      json(response, 200, { status: 'done', outcome: { kind: 'pushed' } });
    } else {
      json(response, 404, {});
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    state,
    close: () =>
      new Promise(resolve => {
        server.closeAllConnections();
        server.close(() => resolve());
      })
  };
}

describe('Session', () => {
  it('shares one refresh among calls at once, since a refresh token works only once', async () => {
    const instance = await fakeInstance();
    const session = new Session(instance.url, 'a@example.invalid', 'pw');
    try {
      await session.login();
      await Promise.all([ session.call('GET', '/me'), session.call('GET', '/me'), session.startEvents() ]);
      expect(instance.state.refreshes).toBe(1);
    } finally {
      session.close();
      await instance.close();
    }
  });

  it('refuses a push channel that does not answer with an event stream', async () => {
    const instance = await fakeInstance({ events: 500 });
    const session = new Session(instance.url, 'a@example.invalid', 'pw');
    try {
      await session.login();
      await expect(session.startEvents()).rejects.toThrow(/failed 5 times in a row: it answered 500/);
      await expect(session.timedJob(1, '/git/push')).rejects.toThrow(/push channel/);
    } finally {
      session.close();
      await instance.close();
    }
  }, 10_000);

  it('times a job from the request that got through, a 429\'s wait left out', async () => {
    const instance = await fakeInstance({ limitFirstPush: true });
    const session = new Session(instance.url, 'a@example.invalid', 'pw');
    try {
      await session.login();
      await session.startEvents();
      const started = performance.now();
      const ms = await session.timedJob(1, '/git/push');
      expect(performance.now() - started).toBeGreaterThan(1000);
      expect(ms).toBeGreaterThanOrEqual(40);
      expect(ms).toBeLessThan(500);
    } finally {
      session.close();
      await instance.close();
    }
  });

  it('drops a job found finished by polling, with no push channel', async () => {
    const instance = await fakeInstance();
    const session = new Session(instance.url, 'a@example.invalid', 'pw');
    try {
      await session.login();
      expect(await session.timedJob(1, '/git/push')).toBeUndefined();
    } finally {
      session.close();
      await instance.close();
    }
  }, 10_000);
});
