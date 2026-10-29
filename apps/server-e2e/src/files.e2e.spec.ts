import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
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

  async function call(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    token?: string,
    body?: unknown
  ): Promise<Answer> {
    const headers: Record<string, string> = token === undefined ? {} : { authorization: `Bearer ${token}` };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    const response = await fetch(`${server.url}/api/v1${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    // 204 has no body.
    const text = await response.text();
    return { status: response.status, body: (text === '' ? {} : JSON.parse(text)) as Record<string, unknown> };
  }

  const folder = (path: string, token = alice.token) =>
    call('GET', `/repositories/${handbook}/folder?path=${encodeURIComponent(path)}`, token);
  const createEntry = (body: unknown, token = alice.token) =>
    call('POST', `/repositories/${handbook}/entries`, token, body);
  const renameEntry = (body: unknown, token = alice.token) =>
    call('POST', `/repositories/${handbook}/entries/rename`, token, body);
  const deleteEntry = (path: string, token = alice.token) =>
    call('DELETE', `/repositories/${handbook}/entries?path=${encodeURIComponent(path)}`, token);
  const saveFile = (body: unknown, token = alice.token) => call('PUT', `/repositories/${handbook}/file`, token, body);
  const recreateFile = (body: unknown, token = alice.token) =>
    call('POST', `/repositories/${handbook}/file/recreate`, token, body);
  const readFile = (path: string, token = alice.token) =>
    call('GET', `/repositories/${handbook}/file?path=${encodeURIComponent(path)}`, token);
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

  it('AC-FILE-001.14: refuses a name taken in another case as a field error', async () => {
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

  it('answers a path inside a submodule like a missing entry', async () => {
    const root = join(server.dataDir, 'repos', String(alice.userId), String(handbook));
    mkdirSync(join(root, 'vendor', 'lib', 'docs'), { recursive: true });
    const sha = execFileSync('git', [ 'hash-object', '-w', 'README.md' ], { cwd: root, encoding: 'utf8' }).trim();
    execFileSync('git', [ 'update-index', '--add', '--cacheinfo', `160000,${sha},vendor/lib` ], { cwd: root });

    for (
      const answer of [
        await folder('vendor/lib/docs'),
        await createEntry({ folder: 'vendor/lib/docs', name: 'a', kind: 'file' }),
        await call('GET', `/repositories/${handbook}/entries/ignored?path=vendor/lib/a.md&kind=file`, alice.token)
      ]
    ) {
      expect(answer.status).toBe(404);
      expect(answer.body['code']).toBe('entry-not-found');
    }
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

  it('AC-FILE-001.26: deletes a folder of 20,000 files in under 2 seconds and frees it in the background', async () => {
    const root = join(server.dataDir, 'repos', String(alice.userId), String(handbook));
    const tmp = join(server.dataDir, 'tmp');
    for (let group = 0; group < 20; group++) {
      const dir = join(root, 'archive', `group-${group}`);
      mkdirSync(dir, { recursive: true });
      for (let index = 0; index < 1000; index++) {
        writeFileSync(join(dir, `note-${index}.md`), `# Note ${index}\n`);
      }
    }

    const started = Date.now();
    const answer = await deleteEntry('archive');
    const elapsed = Date.now() - started;

    expect(answer).toEqual({ status: 204, body: {} });
    expect(elapsed).toBeLessThan(2000);
    expect(existsSync(join(root, 'archive'))).toBe(false);
    expect(await names('')).not.toContain('archive');
    const deadline = Date.now() + 60_000;
    while (readdirSync(tmp).length > 0 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    expect(readdirSync(tmp)).toEqual([]);
  }, 120_000);

  it('refuses .git and paths inside it', async () => {
    const root = join(server.dataDir, 'repos', String(alice.userId), String(handbook));
    for (const path of [ '.git', '.git/config', '.GIT', 'docs/.git' ]) {
      const { status, body } = await deleteEntry(path);
      expect(status, path).toBe(400);
      expect(body).toMatchObject({ code: 'path-refused', params: { reason: 'inside-git' } });
    }
    expect(existsSync(join(root, '.git', 'config'))).toBe(true);

    const rootFolder = await deleteEntry('');
    expect(rootFolder.status).toBe(400);
    expect(rootFolder.body).toMatchObject({ code: 'entry-not-deletable' });
  });

  it('answers another user\'s repository like a missing one', async () => {
    const strip = ({ status, body }: Answer) => ({ status, body: { ...body, requestId: undefined } });
    const suffix = '/entries?path=README.md';

    expect((await call('DELETE', `/repositories/${handbook}${suffix}`)).status).toBe(401);
    const other = await call('DELETE', `/repositories/${handbook}${suffix}`, bob.token);
    const missing = await call('DELETE', `/repositories/${handbook + 1000}${suffix}`, bob.token);
    expect(other.status).toBe(404);
    expect(other.body['code']).toBe('not-found');
    expect(strip(other)).toEqual(strip(missing));
    expect(await names('')).toContain('README.md');
  });

  describe('reading and saving (REQ-EDIT-001)', () => {
    /** 1 MB as stored (ED-2, ED-19). */
    const LIMIT = 1_048_576;
    const rootDir = () => join(server.dataDir, 'repos', String(alice.userId), String(handbook));

    it('saves a 1 MB file within the 2 MB body limit', async () => {
      writeFileSync(join(rootDir(), 'docs', 'big.md'), '# Big\r\n');
      // 62 characters and CRLF: 64 bytes a line, 16,384 lines.
      const content = `${'a'.repeat(62)}\n`.repeat(LIMIT / 64);

      const saved = await saveFile({ path: 'docs/big.md', content, lineEnding: 'crlf', bom: false });

      expect(saved.status).toBe(200);
      expect(saved.body).toMatchObject({ size: LIMIT });
      expect(statSync(join(rootDir(), 'docs', 'big.md')).size).toBe(LIMIT);
      const read = await readFile('docs/big.md');
      expect(read.status).toBe(200);
      expect(read.body).toMatchObject({ lineEnding: 'crlf', bom: false, size: LIMIT, hash: saved.body['hash'] });
      expect(read.body['content']).toBe(content);
    });

    it('AC-EDIT-001.10: refuses a save over 1 MB and accepts it once smaller', async () => {
      writeFileSync(join(rootDir(), 'docs', 'growing.md'), '# Growing\n');

      const tooLarge = await saveFile({
        path: 'docs/growing.md',
        content: 'a'.repeat(LIMIT + 1),
        lineEnding: 'lf',
        bom: false
      });
      expect(tooLarge.status).toBe(413);
      expect(tooLarge.body).toMatchObject({ code: 'file-too-large', params: { limit: LIMIT } });
      expect(readFileSync(join(rootDir(), 'docs', 'growing.md'), 'utf8')).toBe('# Growing\n');

      const smaller = await saveFile({
        path: 'docs/growing.md',
        content: 'a'.repeat(LIMIT),
        lineEnding: 'lf',
        bom: false
      });
      expect(smaller.status).toBe(200);
      expect(statSync(join(rootDir(), 'docs', 'growing.md')).size).toBe(LIMIT);
    });

    it('AC-EDIT-001.11: refuses a save after the file was deleted and recreates it', async () => {
      writeFileSync(join(rootDir(), 'docs', 'gone.md'), '# Gone\n');
      expect((await deleteEntry('docs/gone.md')).status).toBe(204);
      const request = { path: 'docs/gone.md', content: '# Back\n', lineEnding: 'lf', bom: false };

      const refused = await saveFile(request);
      expect(refused.status).toBe(404);
      expect(refused.body).toMatchObject({ code: 'entry-not-found' });
      expect(existsSync(join(rootDir(), 'docs', 'gone.md'))).toBe(false);

      const recreated = await recreateFile(request);
      expect(recreated.status).toBe(201);
      expect(recreated.body).toEqual({ hash: expect.stringMatching(/^[0-9a-f]{64}$/), size: 7 });
      expect(readFileSync(join(rootDir(), 'docs', 'gone.md'), 'utf8')).toBe('# Back\n');

      const again = await recreateFile(request);
      expect(again.status).toBe(409);
      expect(again.body).toMatchObject({ code: 'entry-exists' });
    });

    it('AC-EDIT-001.13: refuses saves while a merge is in progress', async () => {
      // What git leaves behind while a merge waits for its conflicts to be resolved.
      const marker = join(rootDir(), '.git', 'MERGE_HEAD');
      writeFileSync(marker, `${'0'.repeat(40)}\n`);
      try {
        const refused = await saveFile({ path: 'README.md', content: '# Changed\n', lineEnding: 'lf', bom: false });
        expect(refused.status).toBe(409);
        expect(refused.body).toMatchObject({ code: 'merge-in-progress' });
        expect(readFileSync(join(rootDir(), 'README.md'), 'utf8')).toBe('# Handbook\n');
      } finally {
        rmSync(marker);
      }
    });

    it('answers another user\'s repository like a missing one for every new endpoint', async () => {
      const strip = ({ status, body }: Answer) => ({ status, body: { ...body, requestId: undefined } });
      const save = { path: 'README.md', content: 'x', lineEnding: 'lf', bom: false };
      const endpoints = [
        [ 'GET', '/file?path=README.md', undefined ],
        [ 'GET', '/file/state?path=README.md', undefined ],
        [ 'PUT', '/file', save ],
        [ 'POST', '/file/recreate', save ]
      ] as const;
      for (const [ method, suffix, body ] of endpoints) {
        expect((await call(method, `/repositories/${handbook}${suffix}`, undefined, body)).status, suffix).toBe(401);
        const other = await call(method, `/repositories/${handbook}${suffix}`, bob.token, body);
        const missing = await call(method, `/repositories/${handbook + 1000}${suffix}`, bob.token, body);
        expect(other.status, suffix).toBe(404);
        expect(other.body['code']).toBe('not-found');
        expect(strip(other)).toEqual(strip(missing));
      }
      expect(readFileSync(join(rootDir(), 'README.md'), 'utf8')).toBe('# Handbook\n');
    });
  });
});
