import {
  FIXTURE_PASSPHRASE,
  type GitHttpServer,
  type GitSshServer,
  sshKeyFixture,
  startGitHttpServer,
  startGitSshServer
} from '@front-burner/server-core-git/testing';
import BetterSqlite3 from 'better-sqlite3';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { utils } from 'ssh2';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createRemotes, type HoldingProxy, startHoldingProxy } from './support/git-remotes';
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

const TOKEN = 'ghp_e2e-s3cret-token-value';
const PROTECTED_KEY = sshKeyFixture('ed25519-passphrase');
const PROTECTED_PUBLIC = sshKeyFixture('ed25519-passphrase.pub').trim();
const REPOSITORIES = '/api/v1/repositories';
const ACCESS_CHECK = '/api/v1/repositories/access-check';

interface Answer {
  status: number;
  body: Record<string, unknown> & { fields?: { path: string; code: string; params: Record<string, unknown>; }[]; };
}

interface Summary {
  id: number;
  name: string;
  status: string;
  error: string | null;
}

const fieldsOf = (answer: Answer) => answer.body.fields?.map(({ path, code }) => ({ path, code }));

/** A distinctive part of the decrypted private key, as the backend holds it in memory. */
function decryptedKeyBody(): string {
  const parsed = utils.parseKey(PROTECTED_KEY, FIXTURE_PASSPHRASE);
  const key = Array.isArray(parsed) ? parsed[0] : parsed;
  if (key === undefined || key instanceof Error) {
    throw new Error('the fixture does not parse');
  }
  return key.getPrivatePEM().split('\n').filter(line => line !== '' && !line.startsWith('-----')).join('');
}

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

/** The command line and environment of every process this user can read. */
function processTexts(): string[] {
  const texts: string[] = [];
  for (const pid of readdirSync('/proc')) {
    if (!/^\d+$/.test(pid) || Number(pid) === process.pid) {
      continue;
    }
    for (const file of [ 'cmdline', 'environ' ]) {
      try {
        texts.push(readFileSync(`/proc/${pid}/${file}`, 'utf8'));
      } catch {
        // Gone, or another user's.
      }
    }
  }
  return texts;
}

/** A client of one test server: one user's requests. */
class Client {
  constructor(private readonly server: ServerProcess, readonly authToken: string) {}

  async get(path: string): Promise<Answer> {
    const response = await fetch(`${this.server.url}${path}`, {
      headers: { authorization: `Bearer ${this.authToken}` }
    });
    return { status: response.status, body: (await response.json()) as Answer['body'] };
  }

  async post(path: string, body: unknown): Promise<Answer> {
    const response = await postJson(this.server, path, body, { authorization: `Bearer ${this.authToken}` });
    const text = await response.text();
    return { status: response.status, body: (text === '' ? {} : JSON.parse(text)) as Answer['body'] };
  }

  add(body: Record<string, unknown>): Promise<Answer> {
    return this.post(REPOSITORIES, { credentials: { mode: 'none' }, cloneMode: 'full', ...body });
  }

  async recent(): Promise<Summary[]> {
    return (await this.get(`${REPOSITORIES}/recent`)).body['repositories'] as Summary[];
  }

  async statusOf(id: number): Promise<Summary | undefined> {
    return (await this.recent()).find(summary => summary.id === id);
  }

  async settled(id: number): Promise<Summary> {
    await waitFor(async () => (await this.statusOf(id))?.status !== 'cloning');
    return (await this.statusOf(id)) as Summary;
  }

  /** Trusts the host key of an SSH remote, as the dialog's **Trust** does (AR-32). */
  async trust(remoteUrl: string, credentials: unknown): Promise<void> {
    const check = await this.post(ACCESS_CHECK, { remoteUrl, credentials });
    if (check.status === 409 && check.body['code'] === 'host-key-unknown') {
      const { host, port, type, key } = check.body['params'] as Record<string, unknown>;
      expect((await this.post('/api/v1/known-hosts', { host, port, type, key })).status).toBe(204);
    }
  }
}

describe('adding a repository (REQ-REPO-001)', () => {
  let root: string;
  let remotes: { handbook: string; empty: string; };
  let publicGit: GitHttpServer;
  let privateGit: GitHttpServer;
  let ssh: GitSshServer;
  let server: ServerProcess;
  let admin: Client;
  const proxies: HoldingProxy[] = [];

  const publicUrl = (path = 'handbook.git') => `${publicGit.url}/${path}`;
  const privateUrl = (path = 'handbook.git') => `${privateGit.url}/${path}`;
  const sshUrl = (target: { port: number; } = ssh, path = 'handbook.git') =>
    `ssh://git@127.0.0.1:${target.port}/${path}`;
  const newHttps = (name: string, password = TOKEN) => ({ mode: 'new-https', name, username: 'alice', password });

  async function proxyTo(port: number): Promise<HoldingProxy> {
    const proxy = await startHoldingProxy(port);
    proxies.push(proxy);
    return proxy;
  }

  /** How many connections one access check of `remoteUrl` takes through `proxy`. */
  async function connectionsPerCheck(client: Client, proxy: HoldingProxy, remoteUrl: string, credentials: unknown) {
    const before = proxy.connections;
    expect((await client.post(ACCESS_CHECK, { remoteUrl, credentials })).status).toBe(200);
    return proxy.connections - before;
  }

  /** Adds through `proxy` and holds the clone that follows. */
  async function addHeld(client: Client, proxy: HoldingProxy, body: Record<string, unknown>): Promise<Answer> {
    const credentials = body['credentials'] ?? { mode: 'none' };
    const perCheck = await connectionsPerCheck(client, proxy, body['remoteUrl'] as string, credentials);
    proxy.holdFrom(proxy.connections + perCheck);
    return client.add(body);
  }

  async function onboardedServer(
    env: Record<string, string> = {}
  ): Promise<{ server: ServerProcess; client: Client; }> {
    const started = await startServerProcess({ FRONT_BURNER_SETUP_TOKEN: E2E_SETUP_TOKEN, ...env });
    await onboard(started);
    return { server: started, client: new Client(started, (await login(started)).authToken) };
  }

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'front-burner-e2e-add-repository-'));
    remotes = createRemotes(root);
    const repositories = { 'handbook.git': remotes.handbook, 'empty.git': remotes.empty };
    publicGit = await startGitHttpServer({ repositories });
    privateGit = await startGitHttpServer({ repositories, users: { alice: TOKEN } });
    ssh = await startGitSshServer({ repositories, authorizedKeys: [ PROTECTED_PUBLIC ] });
  });

  afterEach(async () => {
    for (const proxy of proxies.splice(0)) {
      await proxy.close();
    }
  });

  afterAll(async () => {
    await Promise.all([ publicGit?.close(), privateGit?.close(), ssh?.close() ]);
    rmSync(root, { recursive: true, force: true });
  });

  describe('the form\'s fields', () => {
    // Each group has its own server: AR-55 allows one user 30 access checks a minute.
    beforeAll(async () => {
      ({ server, client: admin } = await onboardedServer());
    });

    afterAll(async () => {
      await server?.stop();
    });

    it('AC-REPO-001.2: two quick submits create one repository', async () => {
      const body = { remoteUrl: publicUrl(), name: 'Twice' };

      const answers = await Promise.all([ admin.add(body), admin.add(body) ]);

      expect(answers.map(answer => answer.status).sort()).toEqual([ 201, 400 ]);
      expect(fieldsOf(answers.find(answer => answer.status === 400) as Answer)).toEqual([
        { path: 'name', code: 'name-taken' }
      ]);
      expect((await admin.recent()).filter(summary => summary.name === 'Twice')).toHaveLength(1);
    });

    it('AC-REPO-001.3: refuses http, git, file and local URLs, and a token in the URL', async () => {
      for (
        const [ remoteUrl, code ] of [
          [ 'http://github.com/acme/handbook.git', 'unsupported' ],
          [ 'git://github.com/acme/handbook.git', 'unsupported' ],
          [ 'file:///srv/handbook.git', 'unsupported' ],
          [ '/srv/handbook.git', 'unsupported' ],
          [ `https://alice:${TOKEN}@github.com/acme/handbook.git`, 'credentials-in-url' ]
        ]
      ) {
        const answer = await admin.add({ remoteUrl, name: 'Refused' });
        expect(answer.status).toBe(400);
        expect(fieldsOf(answer)).toEqual([ { path: 'remoteUrl', code } ]);
        expect(JSON.stringify(answer.body)).not.toContain(TOKEN);
      }
    });

    it('AC-REPO-001.5: refuses a taken name in any case and accepts the same remote under a new name', async () => {
      expect((await admin.add({ remoteUrl: publicUrl(), name: 'Manual' })).status).toBe(201);

      const taken = await admin.add({ remoteUrl: publicUrl(), name: 'MANUAL' });
      expect(fieldsOf(taken)).toEqual([ { path: 'name', code: 'name-taken' } ]);

      expect((await admin.add({ remoteUrl: publicUrl(), name: 'Manual copy' })).status).toBe(201);
      const index = (await admin.get(`${REPOSITORIES}/index`)).body['repositories'] as { name: string; }[];
      expect(index.map(entry => entry.name)).toEqual(expect.arrayContaining([ 'Manual', 'Manual copy' ]));
    });

    it('AC-REPO-001.7: adds a public repository without credentials; a private one needs some', async () => {
      const before = (await admin.get('/api/v1/credentials')).body;

      expect((await admin.add({ remoteUrl: publicUrl(), name: 'Public' })).status).toBe(201);
      expect((await admin.get('/api/v1/credentials')).body).toEqual(before);

      const refused = await admin.add({ remoteUrl: privateUrl(), name: 'Private' });
      expect(fieldsOf(refused)).toEqual([ { path: 'credentials', code: 'credentials-required' } ]);
    });
  });

  describe('SSH keys and hosts', () => {
    // Each group has its own server: AR-55 allows one user 30 access checks a minute.
    beforeAll(async () => {
      ({ server, client: admin } = await onboardedServer());
    });

    afterAll(async () => {
      await server?.stop();
    });

    it('AC-REPO-001.9: reports a wrong passphrase on its field and keeps a correct one for the session', async () => {
      const remoteUrl = sshUrl();
      const pasted = { mode: 'new-ssh-key', name: 'Passphrase key', privateKey: PROTECTED_KEY };
      await admin.trust(remoteUrl, { ...pasted, passphrase: FIXTURE_PASSPHRASE });

      const wrong = await admin.add({ remoteUrl, name: 'Wrong', credentials: { ...pasted, passphrase: 'wrong' } });
      expect(fieldsOf(wrong)).toEqual([ { path: 'credentials.passphrase', code: 'wrong-passphrase' } ]);

      const added = await admin.add({
        remoteUrl,
        name: 'Passphrase',
        credentials: { ...pasted, passphrase: FIXTURE_PASSPHRASE }
      });
      expect(added.status).toBe(201);
      const keys = (await admin.get('/api/v1/credentials')).body['sshKeys'] as { name: string; unlocked: boolean; }[];
      expect(keys.find(key => key.name === 'Passphrase key')?.unlocked).toBe(true);
      expect((await admin.settled(added.body['id'] as number)).status).toBe('ready');
    });

    it('AC-REPO-001.11: refuses an encrypted key without its passphrase, a DSA key and text that is not a key', async () => {
      for (
        const [ privateKey, field ] of [
          [ PROTECTED_KEY, { path: 'credentials.passphrase', code: 'passphrase-required' } ],
          [ sshKeyFixture('dsa'), { path: 'credentials.privateKey', code: 'unsupported-type' } ],
          [ 'not a key', { path: 'credentials.privateKey', code: 'invalid-key' } ]
        ] as const
      ) {
        const answer = await admin.add({
          remoteUrl: sshUrl(),
          name: 'Bad key',
          credentials: { mode: 'new-ssh-key', name: 'Bad', privateKey }
        });
        expect(fieldsOf(answer)).toEqual([ field ]);
      }
    });

    it('AC-REPO-001.12: a generated key is refused until it is on the server, and kept either way', async () => {
      const generated = await admin.post('/api/v1/credentials/ssh-keys/generate', { name: 'Generated' });
      expect(generated.status).toBe(201);
      const { key, publicKey } = generated.body as { key: { id: number; }; publicKey: string; };
      const credentials = { mode: 'saved', credentialId: key.id };
      await admin.trust(sshUrl(), credentials);

      const refused = await admin.add({ remoteUrl: sshUrl(), name: 'Generated', credentials });
      expect(refused.body.fields).toEqual([
        { path: 'credentials', code: 'credentials-refused', params: { generatedKey: true } }
      ]);
      const keys = (await admin.get('/api/v1/credentials')).body['sshKeys'] as { id: number; }[];
      expect(keys.map(saved => saved.id)).toContain(key.id);

      // The user adds the key on the git server.
      const withKey = await startGitSshServer({
        repositories: { 'handbook.git': remotes.handbook },
        authorizedKeys: [ publicKey ]
      });
      try {
        await admin.trust(sshUrl(withKey), credentials);
        const added = await admin.add({ remoteUrl: sshUrl(withKey), name: 'Generated', credentials });
        expect(added.status).toBe(201);
        expect((await admin.settled(added.body['id'] as number)).status).toBe('ready');
      } finally {
        await withKey.close();
      }
    });

    it('AC-REPO-001.13: asks to trust an unknown host and refuses a changed one', async () => {
      const credentials = {
        mode: 'new-ssh-key',
        name: 'Host check key',
        privateKey: PROTECTED_KEY,
        passphrase: FIXTURE_PASSPHRASE
      };
      const unknown = await admin.post(ACCESS_CHECK, { remoteUrl: sshUrl(), credentials });
      // The host may already be trusted by an earlier test of this file.
      if (unknown.status === 409) {
        expect(unknown.body['code']).toBe('host-key-unknown');
        expect(unknown.body['params']).toMatchObject({
          host: '127.0.0.1',
          port: ssh.port,
          fingerprint: expect.stringMatching(/^SHA256:/)
        });
        await admin.trust(sshUrl(), credentials);
      }
      expect((await admin.post(ACCESS_CHECK, { remoteUrl: sshUrl(), credentials })).status).toBe(200);

      // Another server, whose port the user trusted with the first server's key, looks changed.
      const changed = await startGitSshServer({
        repositories: { 'handbook.git': remotes.handbook },
        authorizedKeys: [ PROTECTED_PUBLIC ]
      });
      try {
        const [ , type, key ] = /^\S+ (\S+) (\S+)/.exec(ssh.hostKeyLine) ?? [];
        expect((await admin.post('/api/v1/known-hosts', { host: '127.0.0.1', port: changed.port, type, key })).status)
          .toBe(204);

        const answer = await admin.post(ACCESS_CHECK, { remoteUrl: sshUrl(changed), credentials });

        expect(answer.body.fields).toEqual([
          { path: 'remoteUrl', code: 'host-key-changed', params: { host: '127.0.0.1' } }
        ]);
      } finally {
        await changed.close();
      }
    });
  });

  describe('the remote and the clone', () => {
    // Each group has its own server: AR-55 allows one user 30 access checks a minute.
    beforeAll(async () => {
      ({ server, client: admin } = await onboardedServer());
    });

    afterAll(async () => {
      await server?.stop();
    });

    it('AC-REPO-001.14: lists the branches and the default branch', async () => {
      const answer = await admin.post(ACCESS_CHECK, { remoteUrl: publicUrl(), credentials: { mode: 'none' } });
      expect(answer).toEqual({ status: 200, body: { branches: [ 'draft', 'main' ], defaultBranch: 'main' } });

      const single = await admin.add({ remoteUrl: publicUrl(), name: 'Single', cloneMode: 'single-branch' });
      expect(fieldsOf(single)).toEqual([ { path: 'branch', code: 'required' } ]);
    });

    it('AC-REPO-001.15: uses the highest allowed level and refuses another', async () => {
      const me = await admin.get('/api/v1/me');
      expect(me.body['allowedGitLevels']).toEqual([ 'advanced' ]);

      const refused = await admin.add({ remoteUrl: publicUrl(), name: 'Simple', gitLevel: 'simple' });
      expect(fieldsOf(refused)).toEqual([ { path: 'gitLevel', code: 'level-not-allowed' } ]);

      const added = await admin.add({ remoteUrl: publicUrl(), name: 'Default level' });
      const sqlite = new BetterSqlite3(join(server.dataDir, 'db', 'front-burner.sqlite'), { readonly: true });
      try {
        expect(sqlite.prepare('SELECT git_level FROM repositories WHERE id = ?').get(added.body['id']))
          .toEqual({ git_level: 'advanced' });
      } finally {
        sqlite.close();
      }
    });

    it('AC-REPO-001.16: reports wrong credentials, a missing repository and an unreachable host, and saves nothing', async () => {
      const credentialsBefore = (await admin.get('/api/v1/credentials')).body;
      const repositoriesBefore = (await admin.recent()).map(summary => summary.id);
      const started = Date.now();

      const wrong = await admin.add({ remoteUrl: privateUrl(), name: 'Wrong', credentials: newHttps('Wrong', 'nope') });
      expect(wrong.body.fields).toEqual([
        { path: 'credentials', code: 'credentials-refused', params: { generatedKey: false } }
      ]);
      const missing = await admin.add({ remoteUrl: publicUrl('missing.git'), name: 'Missing' });
      expect(fieldsOf(missing)).toEqual([ { path: 'remoteUrl', code: 'repository-not-found' } ]);
      const closed = await startHoldingProxy(1);
      await closed.close();
      const unreachable = await admin.add({ remoteUrl: `https://127.0.0.1:${closed.port}/x.git`, name: 'Gone' });
      expect(unreachable.body.fields).toEqual([
        { path: 'remoteUrl', code: 'host-unreachable', params: { host: '127.0.0.1' } }
      ]);

      expect(Date.now() - started).toBeLessThan(30_000);
      expect((await admin.get('/api/v1/credentials')).body).toEqual(credentialsBefore);
      expect((await admin.recent()).map(summary => summary.id)).toEqual(repositoriesBefore);
    });

    it('AC-REPO-001.17: accepts credentials that can only read', async () => {
      // The test servers serve fetches only, so every credential here is read-only.
      const added = await admin.add({ remoteUrl: privateUrl(), name: 'Read only', credentials: newHttps('Read only') });
      expect(added.status).toBe(201);
      expect((await admin.settled(added.body['id'] as number)).status).toBe('ready');
    });

    it('AC-REPO-001.18: the new repository is first as Cloning, and the push channel says when it is ready', async () => {
      const proxy = await proxyTo(Number(new URL(publicGit.url).port));
      const remoteUrl = `https://127.0.0.1:${proxy.port}/handbook.git`;
      const events = await fetch(`${server.url}/api/v1/events`, {
        headers: { authorization: `Bearer ${admin.authToken}` }
      });
      const reader = events.body?.getReader();

      const added = await addHeld(admin, proxy, { remoteUrl, name: 'Live' });
      const id = added.body['id'] as number;
      expect((await admin.recent())[0]).toMatchObject({ id, status: 'cloning' });

      proxy.release();
      let received = '';
      const ready = `"repositoryId":${id},"status":"ready"`;
      while (!received.includes(ready)) {
        const chunk = await reader?.read();
        if (chunk === undefined || chunk.done) {
          throw new Error(`The stream ended. Received:\n${received}`);
        }
        received += new TextDecoder().decode(chunk.value);
      }
      await reader?.cancel();
      expect((await admin.recent())[0]).toMatchObject({ id, status: 'ready', error: null });
    });

    it('AC-REPO-001.21: no secret reaches responses, logs, stored URLs or git processes', async () => {
      const proxy = await proxyTo(Number(new URL(privateGit.url).port));
      const remoteUrl = `https://127.0.0.1:${proxy.port}/handbook.git`;
      const credentials = newHttps('Secret check');

      const added = await addHeld(admin, proxy, { remoteUrl, name: 'Secret check', credentials });
      expect(added.status).toBe(201);
      await new Promise(resolve => setTimeout(resolve, 500));
      const processes = processTexts();
      proxy.release();
      await admin.settled(added.body['id'] as number);

      const secrets = [ TOKEN, FIXTURE_PASSPHRASE, decryptedKeyBody(), PROTECTED_KEY.split('\n')[1] ?? '' ];
      const database = readFileSync(join(server.dataDir, 'db', 'front-burner.sqlite'), 'latin1')
        + readFileSync(join(server.dataDir, 'db', 'front-burner.sqlite-wal'), 'latin1');
      const responses = JSON.stringify([ added.body, await admin.get('/api/v1/credentials'), await admin.recent() ]);
      for (const secret of secrets) {
        expect(server.output()).not.toContain(secret);
        expect(responses).not.toContain(secret);
        expect(database).not.toContain(secret);
        expect(processes.filter(text => text.includes(secret))).toEqual([]);
      }
      const sqlite = new BetterSqlite3(join(server.dataDir, 'db', 'front-burner.sqlite'), { readonly: true });
      try {
        expect(sqlite.prepare('SELECT remote_url FROM repositories WHERE id = ?').get(added.body['id']))
          .toEqual({ remote_url: remoteUrl });
      } finally {
        sqlite.close();
      }
    });

    it('AC-REPO-001.22: another user\'s saved credentials cannot be used', async () => {
      const { userIds: [ bobId ] } = seed(server.dataDir, { users: [ { email: 'bob-add@example.com' } ] });
      const bob = new Client(
        server,
        (await login(server, 'cookie', { ...E2E_ADMIN, email: 'bob-add@example.com' })).authToken
      );
      const saved = (await admin.get('/api/v1/credentials')).body['https'] as { id: number; }[];
      expect(bobId).toBeGreaterThan(0);
      expect(saved.length).toBeGreaterThan(0);

      const credentials = { mode: 'saved', credentialId: saved[0]?.id };
      expect((await bob.post(ACCESS_CHECK, { remoteUrl: privateUrl(), credentials })).status).toBe(404);
      expect((await bob.add({ remoteUrl: privateUrl(), name: 'Stolen', credentials })).status).toBe(404);
      expect((await bob.get('/api/v1/credentials')).body).toEqual({ https: [], sshKeys: [] });
    });

    it('AC-REPO-001.24: refuses the metadata address like an unreachable host', async () => {
      for (const host of [ '169.254.169.254', '[::ffff:169.254.169.254]' ]) {
        const answer = await admin.post(ACCESS_CHECK, {
          remoteUrl: `https://${host}/x.git`,
          credentials: { mode: 'none' }
        });
        expect(fieldsOf(answer)).toEqual([ { path: 'remoteUrl', code: 'host-unreachable' } ]);
      }
    });

    it('AC-REPO-001.25: a clone with a protected key finishes after logout', async () => {
      const proxy = await proxyTo(ssh.port);
      const remoteUrl = sshUrl(proxy);
      const { authToken, refreshToken } = await login(server, 'body');
      const client = new Client(server, authToken);
      const credentials = {
        mode: 'new-ssh-key',
        name: 'Logout key',
        privateKey: PROTECTED_KEY,
        passphrase: FIXTURE_PASSPHRASE
      };
      await client.trust(remoteUrl, credentials);

      const added = await addHeld(client, proxy, { remoteUrl, name: 'After logout', credentials });
      expect(added.status).toBe(201);
      const logout = await postJson(server, '/api/v1/auth/session/logout', { refreshToken }, {
        authorization: `Bearer ${authToken}`
      });
      expect(logout.status).toBe(204);
      proxy.release();

      expect((await admin.settled(added.body['id'] as number)).status).toBe('ready');
    });
  });

  describe('with its own server', () => {
    const cleanups: (() => Promise<void>)[] = [];

    afterEach(async () => {
      for (const cleanup of cleanups.splice(0).reverse()) {
        await cleanup();
      }
    });

    it('AC-REPO-001.19: a clone over the timeout leaves Error and no working copy', async () => {
      const own = await onboardedServer({ FRONT_BURNER_CLONE_TIMEOUT: '2s' });
      cleanups.push(() => own.server.stop());
      const proxy = await proxyTo(Number(new URL(publicGit.url).port));

      const added = await addHeld(own.client, proxy, {
        remoteUrl: `https://127.0.0.1:${proxy.port}/handbook.git`,
        name: 'Slow'
      });
      const id = added.body['id'] as number;

      expect(await own.client.settled(id)).toMatchObject({ status: 'error', error: 'clone-timed-out' });
      expect(
        readdirSync(join(own.server.dataDir, 'repos')).flatMap(user =>
          readdirSync(join(own.server.dataDir, 'repos', user))
        )
      ).toEqual([]);
      expect(readdirSync(join(own.server.dataDir, 'tmp'))).toEqual([]);
    });

    it('AC-REPO-001.19 after a restart: an interrupted clone fails cleanly', async () => {
      const dataDir = mkdtempSync(join(tmpdir(), 'front-burner-e2e-restart-'));
      cleanups.push(async () => rmSync(dataDir, { recursive: true, force: true }));
      const env = { FRONT_BURNER_DATA_DIR: dataDir };
      const first = await onboardedServer(env);
      const proxy = await proxyTo(Number(new URL(publicGit.url).port));

      const added = await addHeld(first.client, proxy, {
        remoteUrl: `https://127.0.0.1:${proxy.port}/handbook.git`,
        name: 'Interrupted'
      });
      const id = added.body['id'] as number;
      await waitFor(() => readdirSync(join(dataDir, 'tmp')).length > 0);
      await first.server.kill();

      const second = await startServerProcess({ FRONT_BURNER_SETUP_TOKEN: E2E_SETUP_TOKEN, ...env });
      cleanups.push(() => second.stop());
      const client = new Client(second, (await login(second)).authToken);

      expect(await client.statusOf(id)).toMatchObject({ status: 'error', error: 'clone-failed' });
      expect(readdirSync(join(dataDir, 'tmp'))).toEqual([]);
      expect(existsSync(join(dataDir, 'repos', '1', String(id)))).toBe(false);
    });

    it('AC-REPO-001.23: refuses the 31st access check in a minute', async () => {
      const own = await onboardedServer();
      cleanups.push(() => own.server.stop());
      for (let i = 0; i < 15; i++) {
        expect((await own.client.post(ACCESS_CHECK, {})).status).toBe(400);
        expect((await own.client.post(REPOSITORIES, {})).status).toBe(400);
      }

      const limited = await own.client.post(ACCESS_CHECK, {});

      expect(limited.status).toBe(429);
      expect(limited.body['code']).toBe('rate-limited');
    });

    it('AC-REPO-001.24: a loopback git server is refused once private networks are blocked', async () => {
      const own = await onboardedServer({ FRONT_BURNER_BLOCK_PRIVATE_NETWORKS: 'true' });
      cleanups.push(() => own.server.stop());

      const answer = await own.client.post(ACCESS_CHECK, { remoteUrl: publicUrl(), credentials: { mode: 'none' } });

      expect(fieldsOf(answer)).toEqual([ { path: 'remoteUrl', code: 'host-unreachable' } ]);
    });
  });
});
