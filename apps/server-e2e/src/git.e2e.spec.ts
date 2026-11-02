import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  E2E_ADMIN,
  E2E_SETUP_TOKEN,
  login,
  onboard,
  seed,
  type ServerProcess,
  startServerProcess
} from './support/server-process';

describe('git status (REQ-GIT-002)', () => {
  let server: ServerProcess;
  let aliceToken: string;
  let bobToken: string;
  let handbook: number;
  let cloning: number;
  let notes: number;
  let notesRoot: string;

  const status = (id: number, token?: string) =>
    fetch(`${server.url}/api/v1/repositories/${id}/git/status`, {
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` }
    });

  beforeAll(async () => {
    server = await startServerProcess({ FRONT_BURNER_SETUP_TOKEN: E2E_SETUP_TOKEN });
    await onboard(server);
    const { userIds: [ aliceId, bobId ] } = seed(server.dataDir, {
      users: [ { email: 'alice@example.com' }, { email: 'bob@example.com' } ]
    });
    const tokenOf = async (email: string) =>
      (await login(server, 'body', { email, password: E2E_ADMIN.password })).authToken;
    aliceToken = await tokenOf('alice@example.com');
    bobToken = await tokenOf('bob@example.com');
    expect(bobId).toBeDefined();
    const seeded = seed(server.dataDir, {
      repositories: [
        { userId: aliceId as number, name: 'handbook', lastAccessedAt: new Date(0) },
        { userId: aliceId as number, name: 'cloning', status: 'cloning', lastAccessedAt: new Date(0) },
        { userId: aliceId as number, name: 'notes', lastAccessedAt: new Date(0) }
      ]
    }).repositoryIds;
    handbook = seeded[0] as number;
    cloning = seeded[1] as number;
    notes = seeded[2] as number;
    notesRoot = join(server.dataDir, 'repos', String(aliceId), String(notes));
    mkdirSync(notesRoot, { recursive: true });
    execFileSync('git', [ 'init', '-q', '-b', 'trunk', notesRoot ]);
    writeFileSync(join(notesRoot, 'a.md'), '# A\n');
    writeFileSync(join(notesRoot, 'b.md'), '# B\n');
    const root = join(server.dataDir, 'repos', String(aliceId), String(handbook));
    mkdirSync(root, { recursive: true });
    execFileSync('git', [ 'init', '-q', '-b', 'main', root ]);
    writeFileSync(join(root, 'README.md'), '# Handbook\n');
  });

  afterAll(async () => {
    await server?.stop();
  });

  it('reports the status of the owner\'s repository', async () => {
    const response = await status(handbook, aliceToken);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      branch: 'main',
      noCommits: true,
      upstream: null,
      ahead: 0,
      behind: 0,
      mergeInProgress: false,
      changes: [ { path: 'README.md', state: 'added' } ]
    });
  });

  it('answers another user like a missing repository', async () => {
    const response = await status(handbook, bobToken);

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'not-found' });
  });

  it('refuses a repository that is not ready', async () => {
    const response = await status(cloning, aliceToken);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'repository-not-openable' });
  });

  it('needs a login', async () => {
    expect((await status(handbook)).status).toBe(401);
  });

  describe('commits', () => {
    const commit = (id: number, body: object, token?: string) =>
      fetch(`${server.url}/api/v1/repositories/${id}/git/commits`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` })
        },
        body: JSON.stringify(body)
      });
    const log = (format: string) =>
      execFileSync('git', [ 'log', '-1', `--format=${format}` ], { cwd: notesRoot, encoding: 'utf8' }).trim();

    it('refuses a commit before the commit author is confirmed', async () => {
      const response = await commit(notes, { message: 'First', paths: [ 'a.md' ] }, aliceToken);

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'commit-author-not-confirmed' });
    });

    it('commits the listed files as the confirmed commit author, creating main', async () => {
      const confirmed = await fetch(`${server.url}/api/v1/preferences/commit-author`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${aliceToken}` },
        body: JSON.stringify({ name: 'Alice Example', email: 'alice@example.com' })
      });
      expect(confirmed.status).toBe(200);

      const response = await commit(notes, { message: 'First notes\n\n# Why\n', paths: [ 'a.md' ] }, aliceToken);

      expect(response.status).toBe(201);
      const { oid } = await response.json() as { oid: string; };
      expect(log('%H')).toBe(oid);
      expect(log('%an <%ae> / %cn <%ce>')).toBe(
        'Alice Example <alice@example.com> / Alice Example <alice@example.com>'
      );
      expect(log('%B')).toBe('First notes\n\n# Why');
      const head = execFileSync('git', [ 'symbolic-ref', 'HEAD' ], { cwd: notesRoot, encoding: 'utf8' }).trim();
      expect(head).toBe('refs/heads/main');
      const after = await (await status(notes, aliceToken)).json() as { changes: unknown[]; };
      expect(after.changes).toEqual([ { path: 'b.md', state: 'added' } ]);
    });

    it('answers nothing-to-commit for files without changes', async () => {
      const response = await commit(notes, { message: 'Again', paths: [ 'a.md' ] }, aliceToken);

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'nothing-to-commit' });
    });

    it('answers another user like a missing repository', async () => {
      const response = await commit(notes, { message: 'Theirs', paths: [ 'b.md' ] }, bobToken);

      expect(response.status).toBe(404);
    });
  });
});
