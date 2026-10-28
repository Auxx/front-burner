import { execFileSync } from 'node:child_process';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
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

interface Answer {
  status: number;
  body: Record<string, unknown>;
}

describe('folder listing (REQ-FILE-001)', () => {
  let server: ServerProcess;
  let alice: { userId: number; token: string; };
  let bob: { userId: number; token: string; };
  /** Alice's ready repository, with a working copy. */
  let handbook: number;

  beforeAll(async () => {
    server = await startServerProcess({ FRONT_BURNER_SETUP_TOKEN: E2E_SETUP_TOKEN });
    await onboard(server);
    const { userIds: [ aliceId, bobId ] } = seed(server.dataDir, {
      users: [ { email: 'alice@example.com' }, { email: 'bob@example.com' } ]
    });
    const tokenOf = async (email: string) =>
      (await login(server, 'body', { email, password: E2E_ADMIN.password })).authToken;
    alice = { userId: aliceId as number, token: await tokenOf('alice@example.com') };
    bob = { userId: bobId as number, token: await tokenOf('bob@example.com') };
    handbook = seed(server.dataDir, {
      repositories: [ { userId: alice.userId, name: 'handbook', lastAccessedAt: new Date(0) } ]
    }).repositoryIds[0] as number;
    const root = join(server.dataDir, 'repos', String(alice.userId), String(handbook));
    mkdirSync(join(root, 'docs'), { recursive: true });
    execFileSync('git', [ 'init', '-q', '-b', 'main', root ]);
    writeFileSync(join(root, 'README.md'), '# Handbook\n');
    writeFileSync(join(root, 'docs', 'guide.md'), '# Guide\n');
    mkdirSync(join(root, '.github'));
    symlinkSync('/etc', join(root, 'etc'));
  });

  afterAll(async () => {
    await server?.stop();
  });

  async function call(method: 'GET' | 'POST', path: string, token?: string): Promise<Answer> {
    const response = await fetch(`${server.url}/api/v1${path}`, {
      method,
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` }
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  const folder = (path: string, token = alice.token) =>
    call('GET', `/repositories/${handbook}/folder?path=${encodeURIComponent(path)}`, token);

  it('lists the root folder', async () => {
    const { status, body } = await folder('');

    expect(status).toBe(200);
    expect(body).toEqual({
      path: '',
      ignored: false,
      more: 0,
      entries: [
        { name: '.github', kind: 'folder', size: null, markdown: false, ignored: false, empty: true },
        { name: 'docs', kind: 'folder', size: null, markdown: false, ignored: false, empty: false },
        { name: 'etc', kind: 'symlink', size: null, markdown: false, ignored: false, empty: false },
        { name: 'README.md', kind: 'file', size: 11, markdown: true, ignored: false, empty: false }
      ]
    });
  });

  it('AC-FILE-001.2: refuses a visitor who is not logged in and answers another user\'s repository like a missing one', async () => {
    const strip = ({ status, body }: Answer) => ({ status, body: { ...body, requestId: undefined } });
    for (const [ method, suffix ] of [ [ 'GET', '' ], [ 'POST', '/open' ], [ 'GET', '/folder' ] ] as const) {
      expect((await call(method, `/repositories/${handbook}${suffix}`)).status).toBe(401);
      const other = await call(method, `/repositories/${handbook}${suffix}`, bob.token);
      const missing = await call(method, `/repositories/${handbook + 1000}${suffix}`, bob.token);
      expect(other.status).toBe(404);
      expect(other.body['code']).toBe('not-found');
      expect(strip(other)).toEqual(strip(missing));
    }
  });

  it('AC-FILE-001.8: refuses paths inside .git', async () => {
    for (const path of [ '.git', '.git/config', 'a/.GIT' ]) {
      const { status, body } = await folder(path);
      expect(status, path).toBe(400);
      expect(body).toMatchObject({ code: 'path-refused', params: { reason: 'inside-git' } });
    }
  });

  it('AC-FILE-001.11: refuses listing through a symbolic link', async () => {
    for (const path of [ 'etc', 'etc/ssh' ]) {
      const { status, body } = await folder(path);
      expect(status, path).toBe(400);
      expect(body).toMatchObject({ code: 'path-refused', params: { reason: 'symlink' } });
    }
  });

  it('refuses ../ paths with path-refused', async () => {
    for (const path of [ '../', '..', 'docs/../..', '/etc' ]) {
      const { status, body } = await folder(path);
      expect(status, path).toBe(400);
      expect(body).toMatchObject({ code: 'path-refused', params: { reason: 'malformed' } });
    }
  });

  it('answers a missing folder and a file with entry-not-found', async () => {
    expect((await folder('nope')).body['code']).toBe('entry-not-found');
    expect((await folder('README.md')).status).toBe(404);
  });

  it('refuses to list a repository that is still cloning, with its status', async () => {
    const [ cloning ] = seed(server.dataDir, {
      repositories: [ { userId: alice.userId, name: 'cloning', status: 'cloning', lastAccessedAt: new Date(0) } ]
    }).repositoryIds;

    const { status, body } = await call('GET', `/repositories/${cloning}/folder`, alice.token);

    expect(status).toBe(409);
    expect(body).toMatchObject({ code: 'repository-not-openable', params: { status: 'cloning' } });
  });

  it('AC-FILE-001.1: opening the repository sets its last access time', async () => {
    const before = Date.now();
    const { status, body } = await call('POST', `/repositories/${handbook}/open`, alice.token);

    expect(status).toBe(200);
    expect(Date.parse(body['lastAccessedAt'] as string)).toBeGreaterThanOrEqual(before - 1000);
  });
});
