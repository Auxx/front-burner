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

  async function call(method: 'GET' | 'POST', path: string, token?: string, body?: unknown): Promise<Answer> {
    const headers: Record<string, string> = token === undefined ? {} : { authorization: `Bearer ${token}` };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    const response = await fetch(`${server.url}/api/v1${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  const folder = (path: string, token = alice.token) =>
    call('GET', `/repositories/${handbook}/folder?path=${encodeURIComponent(path)}`, token);
  const createEntry = (body: unknown, token = alice.token) =>
    call('POST', `/repositories/${handbook}/entries`, token, body);
  const renameEntry = (body: unknown, token = alice.token) =>
    call('POST', `/repositories/${handbook}/entries/rename`, token, body);
  const names = async (path: string) =>
    ((await folder(path)).body['entries'] as { name: string; }[]).map(entry => entry.name);

  /** The first `event:` block of a stream that is not a comment, within `ms`. */
  async function nextEvent(response: Response, ms: number): Promise<unknown> {
    const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader();
    if (reader === undefined) {
      throw new Error('The response has no body');
    }
    const timeout = setTimeout(() => void reader.cancel(), ms);
    let text = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          return undefined;
        }
        text += value;
        const data = /^data: (.*)$/m.exec(text);
        if (data !== null) {
          return JSON.parse(data[1] as string);
        }
      }
    } finally {
      clearTimeout(timeout);
      await reader.cancel().catch(() => undefined);
    }
  }

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

  it('creates, renames and lists a file over the API', async () => {
    const created = await createEntry({ folder: 'docs', name: 'notes', kind: 'file' });
    expect(created).toEqual({ status: 201, body: { path: 'docs/notes.md' } });

    const renamed = await renameEntry({ path: 'docs/notes.md', name: 'ideas.txt' });
    expect(renamed).toEqual({ status: 200, body: { path: 'docs/ideas.txt.md' } });

    expect(await names('docs')).toEqual([ 'guide.md', 'ideas.txt.md' ]);
    const summary = await call('GET', `/repositories/${handbook}/entries/summary?path=docs`, alice.token);
    expect(summary).toEqual({ status: 200, body: { files: 2, nonMarkdown: 0, uncommitted: 2 } });
  });

  it('refuses a name taken in another case as a field error', async () => {
    const { status, body } = await createEntry({ folder: '', name: 'readme.MD', kind: 'file' });

    expect(status).toBe(400);
    expect(body).toMatchObject({ code: 'validation-failed', fields: [ { path: 'name', code: 'name-taken' } ] });
  });

  it('refuses .git as a name and as a folder', async () => {
    const asName = await createEntry({ folder: '', name: '.Git', kind: 'folder' });
    expect(asName.status).toBe(400);
    expect(asName.body).toMatchObject({ code: 'validation-failed', fields: [ { path: 'name', code: 'git' } ] });

    const asFolder = await createEntry({ folder: '.git', name: 'hooks', kind: 'folder' });
    expect(asFolder.status).toBe(400);
    expect(asFolder.body).toMatchObject({ code: 'path-refused', params: { reason: 'inside-git' } });
  });

  it('refuses to rename a symbolic link', async () => {
    const { status, body } = await renameEntry({ path: 'etc', name: 'other' });

    expect(status).toBe(400);
    expect(body).toMatchObject({ code: 'entry-not-renamable' });
  });

  it('says whether a new entry would be ignored', async () => {
    const root = join(server.dataDir, 'repos', String(alice.userId), String(handbook));
    writeFileSync(join(root, '.gitignore'), 'build/\n');
    const ignored = (path: string, kind: string) =>
      call(
        'GET',
        `/repositories/${handbook}/entries/ignored?path=${encodeURIComponent(path)}&kind=${kind}`,
        alice.token
      );

    expect(await ignored('docs/build', 'folder')).toEqual({ status: 200, body: { ignored: true } });
    expect(await ignored('docs/build.md', 'file')).toEqual({ status: 200, body: { ignored: false } });
  });

  it('refuses another user\'s repository like a missing one for every new endpoint', async () => {
    const strip = ({ status, body }: Answer) => ({ status, body: { ...body, requestId: undefined } });
    const endpoints = [
      [ 'POST', '/entries', { folder: '', name: 'a', kind: 'file' } ],
      [ 'POST', '/entries/rename', { path: 'README.md', name: 'b' } ],
      [ 'GET', '/entries/summary?path=README.md', undefined ],
      [ 'GET', '/entries/ignored?path=a.md&kind=file', undefined ]
    ] as const;
    for (const [ method, suffix, body ] of endpoints) {
      expect((await call(method, `/repositories/${handbook}${suffix}`, undefined, body)).status, suffix).toBe(401);
      const other = await call(method, `/repositories/${handbook}${suffix}`, bob.token, body);
      const missing = await call(method, `/repositories/${handbook + 1000}${suffix}`, bob.token, body);
      expect(other.status, suffix).toBe(404);
      expect(other.body['code']).toBe('not-found');
      expect(strip(other)).toEqual(strip(missing));
    }
  });

  it('sends files.changed on the event stream after a create', async () => {
    const stream = await fetch(`${server.url}/api/v1/events`, { headers: { authorization: `Bearer ${alice.token}` } });
    expect(stream.status).toBe(200);
    const event = nextEvent(stream, 5000);

    expect((await createEntry({ folder: '', name: 'drafts', kind: 'folder' })).status).toBe(201);

    expect(await event).toEqual({ type: 'files.changed', repositoryId: handbook, folders: [ '' ] });
  });
});
