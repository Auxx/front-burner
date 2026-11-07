import {
  FIXTURE_PASSPHRASE,
  type GitHttpServer,
  type GitHttpServerOptions,
  type GitSshServer,
  startGitHttpServer,
  startGitSshServer
} from '@front-burner/server-core-git/testing';
import BetterSqlite3 from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  copyRemote,
  createRemotes,
  gitOutput,
  type HoldingProxy,
  pushFromElsewhere,
  refuseWithHook,
  startHoldingProxy
} from './support/git-remotes';
import { decryptedKeyBody, pastedKeyLine, PROTECTED_KEY, PROTECTED_PUBLIC } from './support/secrets';
import {
  E2E_ADMIN,
  E2E_SETUP_TOKEN,
  login,
  onboard,
  postJson,
  seed,
  type ServerProcess,
  startServerProcess
} from './support/server-process';

/** Polls until `check` resolves to true, for at most 20 seconds. */
async function waitFor(check: () => Promise<boolean> | boolean): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (!(await check())) {
    if (Date.now() > deadline) {
      throw new Error('timed out waiting');
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

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
      upstreamGone: false,
      ahead: 0,
      behind: 0,
      mergeInProgress: false,
      changes: [ { path: 'README.md', state: 'added' } ],
      lastCommit: null,
      networkJob: null
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

  it('answers the diff of a file before the first commit', async () => {
    const response = await fetch(`${server.url}/api/v1/repositories/${handbook}/git/diff?path=README.md`, {
      headers: { authorization: `Bearer ${aliceToken}` }
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      kind: 'text',
      lines: [ { type: 'added', oldLine: null, newLine: 1, text: '# Handbook' } ],
      complete: true,
      lineEndingsOnly: false
    });
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

  describe('discard', () => {
    const discard = (id: number, paths: string[], token?: string) =>
      fetch(`${server.url}/api/v1/repositories/${id}/git/discard`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` })
        },
        body: JSON.stringify({ paths })
      });

    it('restores a modified file and deletes an added one, leaving a file it was not given', async () => {
      const committed = readFileSync(join(notesRoot, 'a.md'), 'utf8');
      writeFileSync(join(notesRoot, 'a.md'), 'changed\n');
      writeFileSync(join(notesRoot, 'added.md'), 'added\n');
      writeFileSync(join(notesRoot, 'other.md'), 'other\n');

      const response = await discard(notes, [ 'a.md', 'added.md' ], aliceToken);

      expect(response.status).toBe(204);
      expect(readFileSync(join(notesRoot, 'a.md'), 'utf8')).toBe(committed);
      expect(existsSync(join(notesRoot, 'added.md'))).toBe(false);
      expect(existsSync(join(notesRoot, 'other.md'))).toBe(true);
    });

    it('refuses a path in .git', async () => {
      const response = await discard(notes, [ '.git/config' ], aliceToken);

      expect(response.status).toBe(400);
      expect(existsSync(join(notesRoot, '.git', 'config'))).toBe(true);
    });

    it('answers another user like a missing repository', async () => {
      expect((await discard(notes, [ 'other.md' ], bobToken)).status).toBe(404);
      expect(existsSync(join(notesRoot, 'other.md'))).toBe(true);
    });

    it('needs a login', async () => {
      expect((await discard(notes, [ 'other.md' ])).status).toBe(401);
    });
  });
});

describe('push (REQ-GIT-002, REQ-REPO-002)', () => {
  const TOKEN = 'ghp_e2e-push-token-value';
  let root: string;
  let remotes: { handbook: string; empty: string; };
  let server: ServerProcess;
  let token: string;
  let publicGit: GitHttpServer;
  let privateGit: GitHttpServer;
  const publicOptions: GitHttpServerOptions = { repositories: {} };
  const privateOptions: GitHttpServerOptions = { repositories: {}, users: { alice: TOKEN } };
  const proxies: HoldingProxy[] = [];

  const api = (path: string, init: RequestInit = {}, authToken = token) =>
    fetch(`${server.url}/api/v1${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${authToken}`, ...init.headers }
    });
  const portOf = (git: GitHttpServer) => Number(new URL(git.url).port);

  /** A copy of `source` served under `name` by both test servers. */
  function remote(name: string, source = remotes.handbook): string {
    const bare = copyRemote(root, source, name);
    publicOptions.repositories[`${name}.git`] = bare;
    privateOptions.repositories[`${name}.git`] = bare;
    return bare;
  }

  /** Adds a repository through the API and waits for its clone; returns its ID and working copy. */
  async function add(name: string, remoteUrl: string, credentials: object = { mode: 'none' }) {
    const added = await api('/repositories', {
      method: 'POST',
      body: JSON.stringify({ remoteUrl, name, credentials, cloneMode: 'full' })
    });
    expect(added.status).toBe(201);
    const { id } = await added.json() as { id: number; };
    await waitFor(async () => (await api(`/repositories/${id}/git/status`)).status === 200);
    const [ userDir ] = readdirSync(join(server.dataDir, 'repos'));
    return { id, workingCopy: join(server.dataDir, 'repos', userDir ?? '', String(id)) };
  }

  const commitIn = (workingCopy: string, subject: string) =>
    execFileSync('git', [ 'commit', '-q', '--allow-empty', '-m', subject ], {
      cwd: workingCopy,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'A',
        GIT_AUTHOR_EMAIL: 'a@x.io',
        GIT_COMMITTER_NAME: 'A',
        GIT_COMMITTER_EMAIL: 'a@x.io'
      }
    });

  async function startPush(id: number): Promise<number> {
    const response = await api(`/repositories/${id}/git/push`, { method: 'POST' });
    expect(response.status).toBe(202);
    return (await response.json() as { jobId: number; }).jobId;
  }

  async function jobState(id: number, jobId: number, authToken = token) {
    const response = await api(`/repositories/${id}/git/jobs/${jobId}`, {}, authToken);
    expect(response.status).toBe(200);
    return await response.json() as { status: string; outcome: { kind: string; [key: string]: unknown; } | null; };
  }

  async function pushed(id: number, authToken = token) {
    const jobId = await startPush(id);
    let state = await jobState(id, jobId, authToken);
    await waitFor(async () => {
      state = await jobState(id, jobId, authToken);
      return state.status !== 'queued' && state.status !== 'running';
    });
    return state;
  }

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'front-burner-e2e-push-'));
    remotes = createRemotes(root);
    publicGit = await startGitHttpServer(publicOptions);
    privateGit = await startGitHttpServer(privateOptions);
    server = await startServerProcess({ FRONT_BURNER_SETUP_TOKEN: E2E_SETUP_TOKEN });
    await onboard(server);
    token = (await login(server, 'body')).authToken;
    const confirmed = await api('/preferences/commit-author', {
      method: 'PUT',
      body: JSON.stringify({ name: 'Admin', email: 'admin@example.com' })
    });
    expect(confirmed.status).toBe(200);
  });

  afterEach(async () => {
    for (const proxy of proxies.splice(0)) {
      await proxy.close();
    }
  });

  afterAll(async () => {
    await server?.stop();
    await Promise.all([ publicGit?.close(), privateGit?.close() ]);
    rmSync(root, { recursive: true, force: true });
  });

  it('a push publishes an unpublished branch under the same name and sets its upstream', async () => {
    const bare = remote('publish');
    const { id, workingCopy } = await add('publish', `${publicGit.url}/publish.git`);
    execFileSync('git', [ 'checkout', '-q', '-b', 'feature' ], { cwd: workingCopy });
    commitIn(workingCopy, 'feature work');

    const state = await pushed(id);

    expect(state).toEqual({ status: 'done', outcome: { kind: 'pushed', commits: 1, upstream: 'origin/feature' } });
    expect(gitOutput(bare, 'log', '--format=%s', 'feature')).toBe('feature work\nfirst');
    const status = await (await api(`/repositories/${id}/git/status`)).json() as Record<string, unknown>;
    expect(status).toMatchObject({ branch: 'feature', upstream: 'origin/feature', ahead: 0, networkJob: null });
  });

  it('a push rejected by a server hook returns the remote lines as text', async () => {
    const bare = remote('hooked');
    refuseWithHook(bare, [ 'Pushes are frozen until Monday.', '<b>Ask the release team.</b>' ]);
    const { id, workingCopy } = await add('hooked', `${publicGit.url}/hooked.git`);
    commitIn(workingCopy, 'late change');

    const state = await pushed(id);

    expect(state.outcome).toEqual({
      kind: 'failed',
      code: 'push-rejected',
      params: expect.objectContaining({
        branch: 'main',
        remoteMessages: 'Pushes are frozen until Monday.\n<b>Ask the release team.</b>'
      })
    });
    expect(gitOutput(bare, 'log', '--format=%s', 'main')).toBe('first');
  });

  it('AC-GIT-002.19: in a repository cloned from an empty remote, the first commit creates main and a push publishes it', async () => {
    const bare = remote('blank', remotes.empty);
    const { id, workingCopy } = await add('blank', `${publicGit.url}/blank.git`);
    writeFileSync(join(workingCopy, 'a.md'), '# A\n');
    const committed = await api(`/repositories/${id}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({ message: 'First notes', paths: [ 'a.md' ] })
    });
    expect(committed.status).toBe(201);

    const state = await pushed(id);

    expect(state.outcome).toEqual({ kind: 'pushed', commits: 1, upstream: 'origin/main' });
    expect(gitOutput(bare, 'log', '--format=%s', 'main')).toBe('First notes');
  });

  it('AC-REPO-002.11: a running push finishes after the user logs out', async () => {
    const bare = remote('held');
    const proxy = await startHoldingProxy(portOf(publicGit));
    proxies.push(proxy);
    const { id, workingCopy } = await add('held', `https://127.0.0.1:${proxy.port}/held.git`);
    commitIn(workingCopy, 'before logout');
    const session = await login(server, 'body');
    proxy.holdFrom(proxy.connections);

    const pushing = await api(`/repositories/${id}/git/push`, { method: 'POST' }, session.authToken);
    expect(pushing.status).toBe(202);
    const { jobId } = await pushing.json() as { jobId: number; };
    await waitFor(async () => (await jobState(id, jobId)).status === 'running' && proxy.connections > 0);
    const loggedOut = await postJson(server, '/api/v1/auth/session/logout', { refreshToken: session.refreshToken });
    expect(loggedOut.status).toBe(204);
    expect((await api(`/repositories/${id}/git/jobs/${jobId}`, {}, session.authToken)).status).toBe(401);
    proxy.release();

    await waitFor(async () => (await jobState(id, jobId)).status === 'done');
    expect((await jobState(id, jobId)).outcome).toEqual({ kind: 'pushed', commits: 1, upstream: 'origin/main' });
    expect(gitOutput(bare, 'log', '--format=%s', 'main')).toBe('before logout\nfirst');
  });

  it('reports read-only credentials, refused credentials and a non-fast-forward by their codes', async () => {
    const bare = remote('gate');
    const credentials = { mode: 'new-https', name: 'Gate token', username: 'alice', password: TOKEN };
    const { id, workingCopy } = await add('gate', `${privateGit.url}/gate.git`, credentials);
    commitIn(workingCopy, 'mine');

    privateOptions.refusePush = 403;
    try {
      expect((await pushed(id)).outcome).toMatchObject({ kind: 'failed', code: 'push-not-allowed' });
    } finally {
      delete privateOptions.refusePush;
    }

    privateOptions.users = { alice: 'rotated-token' };
    try {
      expect((await pushed(id)).outcome).toMatchObject({ kind: 'failed', code: 'credentials-refused' });
    } finally {
      privateOptions.users = { alice: TOKEN };
    }

    pushFromElsewhere(bare, 'theirs');
    expect((await pushed(id)).outcome).toMatchObject({ kind: 'failed', code: 'push-non-fast-forward' });
    expect(gitOutput(bare, 'log', '--format=%s', 'main')).toBe('theirs\nfirst');
  });

  it('AC-REPO-002.4: with an expired saved token used by four repositories, updating it fixes the push of all four', async () => {
    const names = [ 'rotate-a', 'rotate-b', 'rotate-c', 'rotate-d' ];
    names.forEach(name => remote(name));
    const credentials = { mode: 'new-https', name: 'GitHub work', username: 'alice', password: TOKEN };
    const first = await add(names[0] ?? '', `${privateGit.url}/${names[0]}.git`, credentials);
    const info = await (await api(`/repositories/${first.id}/credentials`)).json() as { inUse: { id: number; }; };
    const others = [];
    for (const name of names.slice(1)) {
      others.push(await add(name, `${privateGit.url}/${name}.git`, { mode: 'saved', credentialId: info.inUse.id }));
    }
    const all = [ first, ...others ];
    all.forEach(({ workingCopy }, index) => commitIn(workingCopy, `change ${index}`));
    const ROTATED = 'ghp_e2e-rotated-token';
    privateOptions.users = { alice: ROTATED };
    try {
      expect((await pushed(first.id)).outcome).toMatchObject({ kind: 'failed', code: 'credentials-refused' });

      const updated = await api(`/repositories/${first.id}/credentials/token`, {
        method: 'PUT',
        body: JSON.stringify({ username: 'alice', password: ROTATED })
      });

      expect(updated.status).toBe(200);
      const text = await updated.text();
      expect(text).not.toContain(ROTATED);
      expect(JSON.parse(text)).toMatchObject({ inUse: { name: 'GitHub work', usedBy: 4 } });
      for (const { id } of all) {
        expect((await pushed(id)).outcome).toMatchObject({ kind: 'pushed' });
      }
    } finally {
      privateOptions.users = { alice: TOKEN };
    }
  });

  it('AC-REPO-002.5: an update whose access check fails changes nothing', async () => {
    remote('rotate-failed');
    const credentials = { mode: 'new-https', name: 'Failed rotation', username: 'alice', password: TOKEN };
    const { id, workingCopy } = await add('rotate-failed', `${privateGit.url}/rotate-failed.git`, credentials);
    commitIn(workingCopy, 'mine');

    const refused = await api(`/repositories/${id}/credentials/token`, {
      method: 'PUT',
      body: JSON.stringify({ username: 'alice', password: 'still-wrong' })
    });

    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ fields: [ { path: 'credentials', code: 'credentials-refused' } ] });
    // The old token is still the saved one.
    expect((await pushed(id)).outcome).toMatchObject({ kind: 'pushed' });
  });

  it('replacing a repository\'s credentials keeps the old ones and pushes with the new ones', async () => {
    const bare = remote('swap');
    const old = { mode: 'new-https', name: 'Swap old', username: 'alice', password: TOKEN };
    const { id, workingCopy } = await add('swap', `${privateGit.url}/swap.git`, old);
    commitIn(workingCopy, 'swapped');
    const SWAPPED = 'ghp_e2e-swapped-token';
    privateOptions.users = { alice: SWAPPED };
    try {
      const wrongProtocol = await api(`/repositories/${id}/credentials`, {
        method: 'PUT',
        body: JSON.stringify({ mode: 'new-ssh-key', name: 'Key', privateKey: 'x' })
      });
      expect(wrongProtocol.status).toBe(400);
      expect(await wrongProtocol.json()).toMatchObject({
        fields: [ { path: 'credentials', code: 'protocol-mismatch' } ]
      });
      const malformed = await api(`/repositories/${id}/credentials`, {
        method: 'PUT',
        body: JSON.stringify({ mode: 'saved' })
      });
      expect(malformed.status).toBe(400);

      const replaced = await api(`/repositories/${id}/credentials`, {
        method: 'PUT',
        body: JSON.stringify({ mode: 'new-https', name: 'Swap new', username: 'alice', password: SWAPPED })
      });

      expect(replaced.status).toBe(200);
      const text = await replaced.text();
      expect(text).not.toContain(SWAPPED);
      expect(JSON.parse(text)).toMatchObject({ protocol: 'https', inUse: { name: 'Swap new', usedBy: 1 } });
      const saved = await (await api('/credentials')).json() as { https: { name: string; }[]; };
      expect(saved.https.map(entry => entry.name)).toEqual(expect.arrayContaining([ 'Swap new', 'Swap old' ]));
      expect((await pushed(id)).outcome).toMatchObject({ kind: 'pushed' });
      expect(gitOutput(bare, 'log', '--format=%s', 'main')).toBe('swapped\nfirst');
    } finally {
      privateOptions.users = { alice: TOKEN };
    }
  });

  it('reports unsigned commits in plain words (CA-15)', async () => {
    const bare = remote('signed');
    refuseWithHook(bare, [ 'GL-HOOK-ERR: Commit must be signed with a GPG key' ]);
    const { id, workingCopy } = await add('signed', `${publicGit.url}/signed.git`);
    commitIn(workingCopy, 'unsigned');

    const state = await pushed(id);

    expect(state.outcome).toMatchObject({ kind: 'failed', code: 'push-unsigned' });
    const texts = JSON.parse(
      readFileSync(join(__dirname, '..', '..', 'web', 'public', 'i18n', 'en.json'), 'utf8')
    ) as Record<string, string>;
    expect(texts['errors.push-unsigned']).toBe(
      'The remote accepts only signed commits. Front Burner doesn\'t sign commits.'
    );
  });
});

describe('secrets in a push (REQ-REPO-002)', () => {
  const TOKEN = 'ghp_e2e-leak-first-token';
  const REPLACED = 'ghp_e2e-leak-replaced-token';
  const ROTATED = 'ghp_e2e-leak-rotated-token';
  let root: string;
  let server: ServerProcess;
  let https: GitHttpServer;
  let ssh: GitSshServer;
  const httpsOptions: GitHttpServerOptions = { repositories: {}, users: { alice: TOKEN } };
  /** Every response body the test received, in order. */
  const bodies: string[] = [];

  async function call(path: string, init: RequestInit, authToken: string): Promise<Response> {
    const response = await fetch(`${server.url}/api/v1${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${authToken}`, ...init.headers }
    });
    bodies.push(await response.clone().text());
    return response;
  }

  const send = (method: string, path: string, body: unknown, authToken: string) =>
    call(path, { method, body: JSON.stringify(body) }, authToken);

  async function loggedIn(): Promise<string> {
    const session = await login(server, 'body');
    bodies.push(await session.response.text());
    return session.authToken;
  }

  async function add(authToken: string, name: string, remoteUrl: string, credentials: object) {
    const added = await send('POST', '/repositories', { remoteUrl, name, credentials, cloneMode: 'full' }, authToken);
    expect(added.status).toBe(201);
    const { id } = await added.json() as { id: number; };
    await waitFor(async () => (await call(`/repositories/${id}/git/status`, {}, authToken)).status === 200);
    const [ userDir ] = readdirSync(join(server.dataDir, 'repos'));
    return { id, workingCopy: join(server.dataDir, 'repos', userDir ?? '', String(id)) };
  }

  async function commitFile(authToken: string, id: number, workingCopy: string, file: string): Promise<void> {
    writeFileSync(join(workingCopy, file), `# ${file}\n`);
    const committed = await send(
      'POST',
      `/repositories/${id}/git/commits`,
      { message: file, paths: [ file ] },
      authToken
    );
    expect(committed.status).toBe(201);
  }

  async function push(authToken: string, id: number): Promise<{ kind: string; code?: string; }> {
    const started = await call(`/repositories/${id}/git/push`, { method: 'POST' }, authToken);
    expect(started.status).toBe(202);
    const { jobId } = await started.json() as { jobId: number; };
    let state = { status: 'queued', outcome: null as { kind: string; code?: string; } | null };
    await waitFor(async () => {
      state = await (await call(`/repositories/${id}/git/jobs/${jobId}`, {}, authToken)).json() as typeof state;
      return state.status !== 'queued' && state.status !== 'running';
    });
    return state.outcome ?? { kind: 'none' };
  }

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'front-burner-e2e-secrets-'));
    const remotes = createRemotes(root);
    httpsOptions.repositories['notes.git'] = copyRemote(root, remotes.handbook, 'notes');
    https = await startGitHttpServer(httpsOptions);
    ssh = await startGitSshServer({
      repositories: { 'keys.git': copyRemote(root, remotes.handbook, 'keys') },
      authorizedKeys: [ PROTECTED_PUBLIC ]
    });
    server = await startServerProcess({ FRONT_BURNER_SETUP_TOKEN: E2E_SETUP_TOKEN, FRONT_BURNER_LOG_LEVEL: 'debug' });
    await onboard(server);
  });

  afterAll(async () => {
    await server?.stop();
    await Promise.all([ https?.close(), ssh?.close() ]);
    rmSync(root, { recursive: true, force: true });
  });

  it('AC-REPO-002.14: no API response contains a password, token, private key or passphrase, and none appears in the logs', async () => {
    const first = await loggedIn();
    expect(
      (await send('PUT', '/preferences/commit-author', { name: 'Admin', email: 'admin@example.com' }, first)).status
    )
      .toBe(200);
    const notes = await add(first, 'notes', `${https.url}/notes.git`, {
      mode: 'new-https',
      name: 'Notes token',
      username: 'alice',
      password: TOKEN
    });
    const sshUrl = `ssh://git@127.0.0.1:${ssh.port}/keys.git`;
    const pasted = {
      mode: 'new-ssh-key',
      name: 'Pasted key',
      privateKey: PROTECTED_KEY,
      passphrase: FIXTURE_PASSPHRASE
    };
    const check = await send('POST', '/repositories/access-check', { remoteUrl: sshUrl, credentials: pasted }, first);
    expect(check.status).toBe(409);
    const { host, port, type, key } = (await check.json() as { params: Record<string, unknown>; }).params;
    expect((await send('POST', '/known-hosts', { host, port, type, key }, first)).status).toBe(204);
    const keys = await add(first, 'keys', sshUrl, pasted);

    // A new session has the key locked: the push asks for the passphrase, and the unlock lets it run.
    const second = await loggedIn();
    await commitFile(second, keys.id, keys.workingCopy, 'keys.md');
    const locked = await call(`/repositories/${keys.id}/git/push`, { method: 'POST' }, second);
    expect(locked.status).toBe(409);
    const { keyId } = (await locked.json() as { params: { keyId: number; }; }).params;
    const unlocked = await send(
      'POST',
      `/credentials/ssh-keys/${keyId}/unlock`,
      { passphrase: FIXTURE_PASSPHRASE },
      second
    );
    expect(unlocked.status).toBe(204);
    expect(await push(second, keys.id)).toMatchObject({ kind: 'pushed' });

    // A push refused for read-only credentials, then fixed by replacing them and by updating the token.
    await commitFile(second, notes.id, notes.workingCopy, 'notes.md');
    httpsOptions.refusePush = 403;
    expect(await push(second, notes.id)).toMatchObject({ kind: 'failed', code: 'push-not-allowed' });
    delete httpsOptions.refusePush;
    httpsOptions.users = { alice: REPLACED };
    const replaced = await send('PUT', `/repositories/${notes.id}/credentials`, {
      mode: 'new-https',
      name: 'Notes write token',
      username: 'alice',
      password: REPLACED
    }, second);
    expect(replaced.status).toBe(200);
    httpsOptions.users = { alice: ROTATED };
    expect(await push(second, notes.id)).toMatchObject({ kind: 'failed', code: 'credentials-refused' });
    const updated = await send('PUT', `/repositories/${notes.id}/credentials/token`, {
      username: 'alice',
      password: ROTATED
    }, second);
    expect(updated.status).toBe(200);
    expect(await push(second, notes.id)).toMatchObject({ kind: 'pushed' });
    await call('/credentials', {}, second);
    await call(`/repositories/${notes.id}/credentials`, {}, second);
    await call(`/repositories/${keys.id}/credentials`, {}, second);

    const secrets = {
      token: TOKEN,
      'replaced token': REPLACED,
      'rotated token': ROTATED,
      passphrase: FIXTURE_PASSPHRASE,
      password: E2E_ADMIN.password,
      'pasted private key': pastedKeyLine(),
      'decrypted private key': decryptedKeyBody()
    };
    const sqlite = new BetterSqlite3(join(server.dataDir, 'db', 'front-burner.sqlite'), { readonly: true });
    let jobRows: string;
    try {
      const rows = sqlite.prepare('SELECT type, payload, result, error_code FROM jobs').all() as { type: string; }[];
      expect(rows.map(row => row.type)).toContain('sync.push');
      jobRows = JSON.stringify(rows);
    } finally {
      sqlite.close();
    }
    const log = server.output();
    expect(log).toContain('"level":"debug"');
    for (const [ what, secret ] of Object.entries(secrets)) {
      expect(log.includes(secret), `the log contains the ${what}`).toBe(false);
      expect(bodies.filter(body => body.includes(secret)), `a response contains the ${what}`).toEqual([]);
      expect(jobRows.includes(secret), `a job row contains the ${what}`).toBe(false);
    }
  });
});
