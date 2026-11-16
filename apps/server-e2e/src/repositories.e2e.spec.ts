import { type GitHttpServer, startGitHttpServer } from '@front-burner/server-core-git/testing';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { waitFor as waitUntil } from './support/git-api';
import { createRemotes } from './support/git-remotes';
import {
  E2E_ADMIN,
  E2E_SETUP_TOKEN,
  login,
  onboard,
  seed,
  type ServerProcess,
  startServerProcess
} from './support/server-process';

interface Summary {
  id: number;
  name: string;
  remote: string;
  status: string;
  lastAccessedAt: string;
}

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 26, 10, minutes));

describe('recent repositories (REQ-DASH-001)', () => {
  let server: ServerProcess;
  let adminId: number;
  let users = 0;

  beforeAll(async () => {
    server = await startServerProcess({ FRONT_BURNER_SETUP_TOKEN: E2E_SETUP_TOKEN });
    adminId = await onboard(server);
  });

  afterAll(async () => {
    await server?.stop();
  });

  /** A new user of its own for each test, so that tests do not see each other's repositories. */
  function newUser(): number {
    users++;
    return seed(server.dataDir, { users: [ { email: `user${users}@example.com` } ] }).userIds[0] as number;
  }

  async function recent(email: string): Promise<Summary[]> {
    const { authToken } = await login(server, 'body', { email, password: E2E_ADMIN.password });
    const response = await fetch(`${server.url}/api/v1/repositories/recent`, {
      headers: { authorization: `Bearer ${authToken}` }
    });
    expect(response.status).toBe(200);
    return ((await response.json()) as { repositories: Summary[]; }).repositories;
  }

  it('AC-DASH-001.5: of 12 repositories, the 10 most recently accessed, most recent first', async () => {
    const userId = newUser();
    seed(server.dataDir, {
      repositories: Array.from({ length: 12 }, (_, i) => ({ userId, name: `repo-${i}`, lastAccessedAt: at(i) }))
    });

    const names = (await recent(`user${users}@example.com`)).map(repository => repository.name);

    expect(names).toEqual([ 11, 10, 9, 8, 7, 6, 5, 4, 3, 2 ].map(i => `repo-${i}`));
  });

  it('AC-DASH-001.5: all 3 of 3 repositories', async () => {
    const userId = newUser();
    seed(server.dataDir, {
      repositories: [ 'a', 'b', 'c' ].map((name, i) => ({ userId, name, lastAccessedAt: at(i) }))
    });

    expect(await recent(`user${users}@example.com`)).toHaveLength(3);
  });

  it('AC-DASH-001.7: the repository with the newest last access time is first', async () => {
    const userId = newUser();
    seed(server.dataDir, {
      repositories: [
        { userId, name: 'old', lastAccessedAt: at(1) },
        { userId, name: 'added', status: 'cloning', lastAccessedAt: at(30) },
        { userId, name: 'older', lastAccessedAt: at(0) }
      ]
    });

    const [ first ] = await recent(`user${users}@example.com`);

    expect(first).toMatchObject({ name: 'added', status: 'cloning', lastAccessedAt: at(30).toISOString() });
  });

  it('AC-DASH-001.8: two users of one remote each have their own last access time', async () => {
    const alice = newUser();
    const aliceEmail = `user${users}@example.com`;
    const bob = newUser();
    const bobEmail = `user${users}@example.com`;
    const remoteUrl = 'https://github.com/acme/shared.git';
    seed(server.dataDir, {
      repositories: [
        { userId: alice, name: 'shared', remoteUrl, lastAccessedAt: at(50) },
        { userId: alice, name: 'mine', lastAccessedAt: at(40) },
        { userId: bob, name: 'shared', remoteUrl, lastAccessedAt: at(10) },
        { userId: bob, name: 'his', lastAccessedAt: at(20) }
      ]
    });

    const aliceList = await recent(aliceEmail);
    const bobList = await recent(bobEmail);

    expect(aliceList.map(repository => repository.name)).toEqual([ 'shared', 'mine' ]);
    expect(bobList.map(repository => repository.name)).toEqual([ 'his', 'shared' ]);
    expect(aliceList[0]?.id).not.toBe(bobList[1]?.id);
  });

  it('AC-DASH-001.9: the administrator and another user see only their own repositories', async () => {
    const userId = newUser();
    const email = `user${users}@example.com`;
    seed(server.dataDir, {
      repositories: [
        { userId: adminId, name: 'admin-notes', lastAccessedAt: at(0) },
        { userId, name: 'user-notes', lastAccessedAt: at(0) }
      ]
    });

    expect((await recent(E2E_ADMIN.email)).map(repository => repository.name)).toEqual([ 'admin-notes' ]);
    expect((await recent(email)).map(repository => repository.name)).toEqual([ 'user-notes' ]);
  });

  it('AC-DASH-001.10: the remote as host and path, never with credentials', async () => {
    const userId = newUser();
    seed(server.dataDir, {
      repositories: [
        { userId, name: 'https', remoteUrl: 'https://github.com/acme/handbook.git', lastAccessedAt: at(3) },
        { userId, name: 'ssh', remoteUrl: 'git@github.com:acme/handbook.git', lastAccessedAt: at(2) },
        { userId, name: 'token', remoteUrl: 'https://u:t@github.com/acme/handbook.git', lastAccessedAt: at(1) }
      ]
    });

    const list = await recent(`user${users}@example.com`);

    expect(list.map(repository => repository.remote)).toEqual(Array(3).fill('github.com/acme/handbook'));
    expect(JSON.stringify(list)).not.toContain('u:t');
  });

  it('recent requires a login', async () => {
    const response = await fetch(`${server.url}/api/v1/repositories/recent`);
    expect(response.status).toBe(401);
    expect(((await response.json()) as { code: string; }).code).toBe('unauthenticated');
  });
});

describe('all repositories (REQ-REPO-003)', () => {
  let server: ServerProcess;
  let adminId: number;
  let users = 0;

  beforeAll(async () => {
    server = await startServerProcess({ FRONT_BURNER_SETUP_TOKEN: E2E_SETUP_TOKEN });
    adminId = await onboard(server);
  });

  afterAll(async () => {
    await server?.stop();
  });

  /** A new user of its own for each test, so that tests do not see each other's repositories. */
  function newUser(): { userId: number; email: string; } {
    users++;
    const email = `list${users}@example.com`;
    return { userId: seed(server.dataDir, { users: [ { email } ] }).userIds[0] as number, email };
  }

  async function list(email: string): Promise<Summary[]> {
    const { authToken } = await login(server, 'body', { email, password: E2E_ADMIN.password });
    const response = await fetch(`${server.url}/api/v1/repositories`, {
      headers: { authorization: `Bearer ${authToken}` }
    });
    expect(response.status).toBe(200);
    return ((await response.json()) as { repositories: Summary[]; }).repositories;
  }

  it('lists every repository of the user in every status, by name ignoring case', async () => {
    const { userId, email } = newUser();
    const names = Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? `Repo-${i + 10}` : `repo-${i + 10}`));
    seed(server.dataDir, {
      repositories: [
        ...names.map((name, i) => ({ userId, name, lastAccessedAt: at(i) })),
        { userId, name: 'zeta', status: 'error', errorCode: 'clone-failed', lastAccessedAt: at(30) },
        { userId, name: 'Alpha', status: 'cloning', lastAccessedAt: at(0) },
        { userId: adminId, name: 'admin-notes', lastAccessedAt: at(0) }
      ]
    });

    const repositories = await list(email);

    expect(repositories.map(repository => repository.name)).toEqual([ 'Alpha', ...names, 'zeta' ]);
    expect(repositories.map(repository => repository.status)).toEqual([
      'cloning',
      ...names.map(() => 'ready'),
      'error'
    ]);
  });

  it('does not change the last access time', async () => {
    const { userId, email } = newUser();
    seed(server.dataDir, { repositories: [ { userId, name: 'handbook', lastAccessedAt: at(5) } ] });

    await list(email);

    expect((await list(email))[0]?.lastAccessedAt).toBe(at(5).toISOString());
  });

  it('requires a login', async () => {
    const response = await fetch(`${server.url}/api/v1/repositories`);
    expect(response.status).toBe(401);
  });
});

describe('repository details (REQ-REPO-003)', () => {
  let server: ServerProcess;
  let adminId: number;

  beforeAll(async () => {
    server = await startServerProcess({ FRONT_BURNER_SETUP_TOKEN: E2E_SETUP_TOKEN });
    adminId = await onboard(server);
  });

  afterAll(async () => {
    await server?.stop();
  });

  async function details(email: string, id: number): Promise<Response> {
    const { authToken } = await login(server, 'body', { email, password: E2E_ADMIN.password });
    return fetch(`${server.url}/api/v1/repositories/${id}/details`, {
      headers: { authorization: `Bearer ${authToken}` }
    });
  }

  it('answers a failed single-branch clone\'s details, without credentials', async () => {
    const [ id ] = seed(server.dataDir, {
      repositories: [ {
        userId: adminId,
        name: 'handbook',
        remoteUrl: 'https://alice:ghp_token@github.com/acme/handbook.git',
        branch: 'main',
        status: 'error',
        errorCode: 'clone-failed',
        errorDetail: 'fatal: repository not found',
        errorRequestId: 'request-1',
        createdAt: at(1),
        lastAccessedAt: at(5)
      } ]
    }).repositoryIds;

    const response = await details(E2E_ADMIN.email, id as number);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      summary: {
        id,
        name: 'handbook',
        remote: 'github.com/acme/handbook',
        status: 'error',
        error: 'clone-failed',
        warnings: [],
        clone: null,
        lastAccessedAt: at(5).toISOString()
      },
      cloneMode: 'single-branch',
      branch: 'main',
      gitLevel: 'advanced',
      addedAt: at(1).toISOString(),
      errorDetail: 'fatal: repository not found',
      errorRequestId: 'request-1',
      remoteProblems: { fetch: null, push: null }
    });
    expect(JSON.stringify(body)).not.toContain('ghp_token');
  });

  it('answers another user\'s repository like a missing one', async () => {
    const email = 'details-other@example.com';
    const userId = seed(server.dataDir, { users: [ { email } ] }).userIds[0] as number;
    const [ secret ] = seed(server.dataDir, { repositories: [ { userId, name: 'secret', lastAccessedAt: at(0) } ] })
      .repositoryIds;

    const other = await details(E2E_ADMIN.email, secret as number);
    const none = await details(E2E_ADMIN.email, (secret as number) + 100);

    expect(other.status).toBe(404);
    expect(none.status).toBe(404);
    const strip = (body: Record<string, unknown>) => ({ ...body, requestId: undefined });
    const otherBody = (await other.json()) as Record<string, unknown>;
    expect(otherBody.code).toBe('not-found');
    expect(strip(otherBody)).toEqual(strip((await none.json()) as Record<string, unknown>));
  });

  it('requires a login', async () => {
    const response = await fetch(`${server.url}/api/v1/repositories/1/details`);
    expect(response.status).toBe(401);
  });
});

describe('what removing would lose (REQ-REPO-003)', () => {
  let server: ServerProcess;
  let adminId: number;
  let remotesRoot: string;
  let handbook: string;

  beforeAll(async () => {
    server = await startServerProcess({ FRONT_BURNER_SETUP_TOKEN: E2E_SETUP_TOKEN });
    adminId = await onboard(server);
    remotesRoot = mkdtempSync(join(tmpdir(), 'fb-removal-e2e-'));
    handbook = createRemotes(remotesRoot).handbook;
  });

  afterAll(async () => {
    await server?.stop();
    rmSync(remotesRoot, { recursive: true, force: true });
  });

  async function removal(email: string, id: number): Promise<Response> {
    const { authToken } = await login(server, 'body', { email, password: E2E_ADMIN.password });
    return fetch(`${server.url}/api/v1/repositories/${id}/removal`, {
      headers: { authorization: `Bearer ${authToken}` }
    });
  }

  it('counts 2 uncommitted files and 3 commits not pushed', async () => {
    const [ id ] = seed(server.dataDir, {
      repositories: [ { userId: adminId, name: 'handbook', lastAccessedAt: at(0) } ]
    }).repositoryIds;
    const work = join(server.dataDir, 'repos', String(adminId), String(id));
    mkdirSync(join(server.dataDir, 'repos', String(adminId)), { recursive: true });
    execFileSync('git', [ 'clone', '-q', handbook, work ]);
    for (const subject of [ 'one', 'two', 'three' ]) {
      execFileSync('git', [
        '-c',
        'user.name=E2E',
        '-c',
        'user.email=e2e@example.com',
        'commit',
        '-q',
        '--allow-empty',
        '-m',
        subject
      ], { cwd: work });
    }
    writeFileSync(join(work, 'a.md'), '# A\n');
    writeFileSync(join(work, 'b.md'), '# B\n');

    const response = await removal(E2E_ADMIN.email, id as number);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      uncommittedFiles: 2,
      unpushedCommits: 3,
      stashes: 0,
      mergeInProgress: false,
      unreadable: false
    });
  });

  it('answers another user\'s repository like a missing one', async () => {
    const email = 'removal-other@example.com';
    const userId = seed(server.dataDir, { users: [ { email } ] }).userIds[0] as number;
    const [ secret ] = seed(server.dataDir, { repositories: [ { userId, name: 'secret', lastAccessedAt: at(0) } ] })
      .repositoryIds;

    const other = await removal(E2E_ADMIN.email, secret as number);
    const none = await removal(E2E_ADMIN.email, (secret as number) + 100);

    expect(other.status).toBe(404);
    expect(none.status).toBe(404);
    const strip = (body: Record<string, unknown>) => ({ ...body, requestId: undefined });
    const otherBody = (await other.json()) as Record<string, unknown>;
    expect(otherBody.code).toBe('not-found');
    expect(strip(otherBody)).toEqual(strip((await none.json()) as Record<string, unknown>));
  });

  it('requires a login', async () => {
    const response = await fetch(`${server.url}/api/v1/repositories/1/removal`);
    expect(response.status).toBe(401);
  });
});

describe('removing a repository (REQ-REPO-003)', () => {
  let server: ServerProcess;
  let adminId: number;
  let remotesRoot: string;
  let handbook: string;

  beforeAll(async () => {
    server = await startServerProcess({ FRONT_BURNER_SETUP_TOKEN: E2E_SETUP_TOKEN });
    adminId = await onboard(server);
    remotesRoot = mkdtempSync(join(tmpdir(), 'fb-remove-e2e-'));
    handbook = createRemotes(remotesRoot).handbook;
  });

  afterAll(async () => {
    await server?.stop();
    rmSync(remotesRoot, { recursive: true, force: true });
  });

  async function as(email: string, method: string, path: string): Promise<Response> {
    const { authToken } = await login(server, 'body', { email, password: E2E_ADMIN.password });
    return fetch(`${server.url}/api/v1${path}`, { method, headers: { authorization: `Bearer ${authToken}` } });
  }

  /** A ready repository of the administrator's, with a clone of the fixture remote as its working copy. */
  function cloned(name: string): { id: number; work: string; } {
    const id = seed(server.dataDir, { repositories: [ { userId: adminId, name, lastAccessedAt: at(0) } ] })
      .repositoryIds[0] as number;
    const work = join(server.dataDir, 'repos', String(adminId), String(id));
    mkdirSync(join(server.dataDir, 'repos', String(adminId)), { recursive: true });
    execFileSync('git', [ 'clone', '-q', handbook, work ]);
    return { id, work };
  }

  /** Polls until `check` holds, for at most 10 seconds. */
  async function waitFor(check: () => boolean): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (!check()) {
      if (Date.now() > deadline) {
        throw new Error('timed out waiting');
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  it('removes a clean repository with one request, and deletes its working copy', async () => {
    const { id, work } = cloned('clean');

    const response = await as(E2E_ADMIN.email, 'DELETE', `/repositories/${id}`);

    expect(response.status).toBe(204);
    expect(existsSync(work)).toBe(false);
    const list = (await (await as(E2E_ADMIN.email, 'GET', '/repositories')).json()) as {
      repositories: Summary[];
    };
    expect(list.repositories.map(repository => repository.id)).not.toContain(id);
    expect((await as(E2E_ADMIN.email, 'GET', `/repositories/${id}`)).status).toBe(404);
    await waitFor(() => readdirSync(join(server.dataDir, 'tmp')).every(name => !name.startsWith(`remove-${id}-`)));
  });

  it('needs the name when work would be lost', async () => {
    const { id, work } = cloned('Dirty');
    writeFileSync(join(work, 'a.md'), '# A\n');

    const refused = await as(E2E_ADMIN.email, 'DELETE', `/repositories/${id}?confirmName=dirty`);

    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({
      code: 'removal-needs-confirmation',
      params: { uncommittedFiles: 1, unpushedCommits: 0, stashes: 0, mergeInProgress: false, unreadable: false }
    });
    expect(existsSync(join(work, 'a.md'))).toBe(true);

    const removed = await as(E2E_ADMIN.email, 'DELETE', `/repositories/${id}?confirmName=Dirty`);

    expect(removed.status).toBe(204);
    expect(existsSync(work)).toBe(false);
  });

  it('answers another user\'s repository like a missing one', async () => {
    const email = 'remove-other@example.com';
    const userId = seed(server.dataDir, { users: [ { email } ] }).userIds[0] as number;
    const [ secret ] = seed(server.dataDir, { repositories: [ { userId, name: 'secret', lastAccessedAt: at(0) } ] })
      .repositoryIds;

    const other = await as(E2E_ADMIN.email, 'DELETE', `/repositories/${secret}?confirmName=secret`);
    const none = await as(E2E_ADMIN.email, 'DELETE', `/repositories/${(secret as number) + 100}?confirmName=secret`);

    expect(other.status).toBe(404);
    expect(none.status).toBe(404);
    const strip = (body: Record<string, unknown>) => ({ ...body, requestId: undefined });
    expect(strip((await other.json()) as Record<string, unknown>)).toEqual(
      strip((await none.json()) as Record<string, unknown>)
    );
    expect((await as(email, 'GET', `/repositories/${secret}`)).status).toBe(200);
  });

  it('requires a login', async () => {
    const response = await fetch(`${server.url}/api/v1/repositories/1`, { method: 'DELETE' });
    expect(response.status).toBe(401);
  });
});

describe('cloning a repository again (REQ-REPO-003)', () => {
  let server: ServerProcess;
  let adminId: number;
  let remotesRoot: string;
  let gitServer: GitHttpServer;

  beforeAll(async () => {
    server = await startServerProcess({ FRONT_BURNER_SETUP_TOKEN: E2E_SETUP_TOKEN });
    adminId = await onboard(server);
    remotesRoot = mkdtempSync(join(tmpdir(), 'fb-clone-again-e2e-'));
    gitServer = await startGitHttpServer({ repositories: { 'handbook.git': createRemotes(remotesRoot).handbook } });
  });

  afterAll(async () => {
    await gitServer?.close();
    await server?.stop();
    rmSync(remotesRoot, { recursive: true, force: true });
  });

  async function as(email: string, method: string, path: string): Promise<Response> {
    const { authToken } = await login(server, 'body', { email, password: E2E_ADMIN.password });
    return fetch(`${server.url}/api/v1${path}`, { method, headers: { authorization: `Bearer ${authToken}` } });
  }

  const summaryOf = async (id: number) =>
    (await (await as(E2E_ADMIN.email, 'GET', `/repositories/${id}`)).json()) as Summary & { error: string | null; };

  it('clones a damaged working copy again, keeping the last access time', async () => {
    const [ id ] = seed(server.dataDir, {
      repositories: [ {
        userId: adminId,
        name: 'damaged',
        remoteUrl: `${gitServer.url}/handbook.git`,
        status: 'error',
        errorCode: 'working-copy-missing',
        lastAccessedAt: at(5)
      } ]
    }).repositoryIds as [ number ];
    const work = join(server.dataDir, 'repos', String(adminId), String(id));
    mkdirSync(work, { recursive: true });
    writeFileSync(join(work, 'left-over.md'), '# Left over\n');

    const response = await as(E2E_ADMIN.email, 'POST', `/repositories/${id}/clone`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id, status: 'cloning', error: null });
    await waitUntil(async () => (await summaryOf(id)).status !== 'cloning');
    expect(await summaryOf(id)).toMatchObject({ status: 'ready', error: null, lastAccessedAt: at(5).toISOString() });
    expect(existsSync(join(work, '.git'))).toBe(true);
    expect(existsSync(join(work, 'left-over.md'))).toBe(false);
  });

  it('refuses a ready repository', async () => {
    const [ id ] = seed(server.dataDir, { repositories: [ { userId: adminId, name: 'ready', lastAccessedAt: at(0) } ] })
      .repositoryIds as [ number ];

    const response = await as(E2E_ADMIN.email, 'POST', `/repositories/${id}/clone`);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'repository-not-in-error', params: { status: 'ready' } });
  });

  it('answers another user\'s repository like a missing one', async () => {
    const email = 'clone-again-other@example.com';
    const userId = seed(server.dataDir, { users: [ { email } ] }).userIds[0] as number;
    const [ secret ] = seed(server.dataDir, {
      repositories: [ { userId, name: 'secret', status: 'error', errorCode: 'clone-failed', lastAccessedAt: at(0) } ]
    }).repositoryIds as [ number ];

    const other = await as(E2E_ADMIN.email, 'POST', `/repositories/${secret}/clone`);
    const none = await as(E2E_ADMIN.email, 'POST', `/repositories/${secret + 100}/clone`);

    expect(other.status).toBe(404);
    expect(none.status).toBe(404);
    // Not cloned again either.
    expect(await (await as(email, 'GET', `/repositories/${secret}`)).json()).toMatchObject({ status: 'error' });
  });

  it('requires a login', async () => {
    const response = await fetch(`${server.url}/api/v1/repositories/1/clone`, { method: 'POST' });
    expect(response.status).toBe(401);
  });
});

describe('another user\'s repository (REQ-REPO-003)', () => {
  let server: ServerProcess;

  beforeAll(async () => {
    server = await startServerProcess({ FRONT_BURNER_SETUP_TOKEN: E2E_SETUP_TOKEN });
    await onboard(server);
  });

  afterAll(async () => {
    await server?.stop();
  });

  /** Every endpoint of REQ-REPO-003 that names a repository, with a body it would accept. */
  const endpoints: { method: string; path: (id: number) => string; body?: unknown; }[] = [
    { method: 'GET', path: id => `/repositories/${id}` },
    { method: 'GET', path: id => `/repositories/${id}/details` },
    { method: 'GET', path: id => `/repositories/${id}/removal` },
    { method: 'DELETE', path: id => `/repositories/${id}?confirmName=secret` },
    { method: 'POST', path: id => `/repositories/${id}/clone` },
    { method: 'GET', path: id => `/repositories/${id}/credentials` },
    { method: 'PUT', path: id => `/repositories/${id}/credentials`, body: { mode: 'none' } },
    {
      method: 'PUT',
      path: id => `/repositories/${id}/credentials/token`,
      body: { username: 'mallory', password: 'stolen-token' }
    },
    { method: 'GET', path: id => `/repositories/${id}/commit-author` },
    {
      method: 'PUT',
      path: id => `/repositories/${id}/commit-author`,
      body: { name: 'Mallory', email: 'mallory@example.com' }
    },
    { method: 'DELETE', path: id => `/repositories/${id}/commit-author` }
  ];

  it('AC-REPO-003.14: a request for another user\'s repository settings, or to remove another user\'s repository, gets the same response as for a repository that does not exist', async () => {
    const email = 'owner@example.com';
    // Both plain users: the administrator may have routes of its own to other users' repositories (A-7.4).
    const intruder = 'intruder@example.com';
    const ownerId = seed(server.dataDir, { users: [ { email }, { email: intruder } ] }).userIds[0] as number;
    const [ secret ] = seed(server.dataDir, {
      repositories: [ {
        userId: ownerId,
        name: 'secret',
        remoteUrl: 'https://github.com/acme/secret.git',
        status: 'error',
        errorCode: 'clone-failed',
        errorDetail: 'fatal: repository not found',
        lastAccessedAt: at(0)
      } ]
    }).repositoryIds as [ number ];
    const missing = secret + 100;
    const { authToken } = await login(server, 'body', { email: intruder, password: E2E_ADMIN.password });
    const call = async (method: string, path: string, body?: unknown) => {
      const response = await fetch(`${server.url}/api/v1${path}`, {
        method,
        headers: { authorization: `Bearer ${authToken}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      const text = await response.text();
      // An empty body, such as a 204 that removed it, fails on the comparison that names the endpoint.
      return {
        status: response.status,
        body: { ...(text === '' ? {} : JSON.parse(text)), requestId: undefined } as Record<string, unknown>
      };
    };
    const owner = await login(server, 'body', { email, password: E2E_ADMIN.password });
    const asOwner = async (path: string) =>
      (await fetch(`${server.url}/api/v1${path}`, { headers: { authorization: `Bearer ${owner.authToken}` } }))
        .json();
    const before = {
      details: await asOwner(`/repositories/${secret}/details`),
      credentials: await asOwner(`/repositories/${secret}/credentials`),
      author: await asOwner(`/repositories/${secret}/commit-author`)
    };

    for (const endpoint of endpoints) {
      const theirs = await call(endpoint.method, endpoint.path(secret), endpoint.body);
      const none = await call(endpoint.method, endpoint.path(missing), endpoint.body);

      expect(theirs, `${endpoint.method} ${endpoint.path(secret)}`).toEqual(none);
      expect(theirs, `${endpoint.method} ${endpoint.path(secret)}`).toMatchObject({
        status: 404,
        body: { code: 'not-found' }
      });
    }

    // Not listed, and nothing of the owner's changed.
    const listed = await call('GET', '/repositories');
    expect((listed.body['repositories'] as Summary[]).map(repository => repository.id)).not.toContain(secret);
    expect(await asOwner(`/repositories/${secret}/details`)).toEqual(before.details);
    expect(await asOwner(`/repositories/${secret}/credentials`)).toEqual(before.credentials);
    expect(await asOwner(`/repositories/${secret}/commit-author`)).toEqual(before.author);
  });
});
