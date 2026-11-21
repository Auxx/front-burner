import BetterSqlite3 from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRemote, fillDataDir, git, markdownOf, scaleUserEmail, startGitServer, timedGit } from './perf-api.mjs';
import { WORKSPACE_ROOT } from './workspace.mjs';

let dir;

beforeEach(() => {
  mkdirSync(join(WORKSPACE_ROOT, 'tmp'), { recursive: true });
  dir = mkdtempSync(join(WORKSPACE_ROOT, 'tmp', 'perf-api-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
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
