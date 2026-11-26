import { safeVersion } from '@front-burner/server-core-database';
import { type GitHttpServer, startGitHttpServer } from '@front-burner/server-core-git/testing';
import { chmodSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildUpgradeImage,
  type Container,
  E2E_IMAGE,
  removeImage,
  type RunResult,
  startContainer,
  UPGRADE_TEST_VERSION
} from './support/container';
import { waitFor } from './support/git-api';
import {
  copyRemote,
  createRemotes,
  type HoldingProxy,
  pushFileFromElsewhere,
  startHoldingProxy
} from './support/git-remotes';
import { E2E_ADMIN, E2E_SETUP_TOKEN } from './support/server-process';

/**
 * The release image survives what NF-6, NF-7 and NF-9 promise (plan 153):
 * kills (`docker kill --signal KILL`, not a stop) in the middle of a clone, a
 * pull's merge and a merge waiting for resolution; a full repositories volume;
 * a backup and a restore, and an upgrade and going back, each following the
 * deployment guide's commands (`docs/wiki/deployment.md`) step by step.
 *
 * Runs only when `E2E_IMAGE` names an image, as `container.e2e.spec.ts` does;
 * the upgrade also needs `E2E_UPGRADE_TEST=true`, as it builds a second image
 * (CI on pushes to master, and the release workflow):
 *
 *   docker build -f tools/docker/Dockerfile -t front-burner:test .
 *   E2E_IMAGE=front-burner:test E2E_UPGRADE_TEST=true npx nx run server-e2e:e2e-container
 */

const SLOW_MS = 180_000;
/** Building the upgrade image: the server and the web client again. */
const BUILD_MS = 30 * 60_000;
const UPGRADE_TEST = process.env['E2E_UPGRADE_TEST'] === 'true';
const AUTHOR = { name: 'Admin Example', email: 'admin.example@example.com' };

interface Answer {
  status: number;
  body: Record<string, unknown>;
  headers: Headers;
}

interface Summary {
  id: number;
  name: string;
  status: string;
  error: string | null;
}

interface JobState {
  status: string;
  outcome: { kind: string; [key: string]: unknown; } | null;
}

/** One administrator's calls to an instance in a container. */
class Instance {
  authToken = '';

  constructor(readonly container: Container) {}

  /** `token` is the administrator's by default; `null` sends none. */
  async call(method: string, path: string, body?: unknown, token: string | null = this.authToken): Promise<Answer> {
    const headers: Record<string, string> = token === null || token === '' ? {} : { authorization: `Bearer ${token}` };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    const response = await fetch(`${this.container.url}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    return {
      status: response.status,
      body: (text === '' ? {} : JSON.parse(text)) as Record<string, unknown>,
      headers: response.headers
    };
  }

  /** The version the instance reports (NF-7.6). */
  async version(): Promise<string | null> {
    return (await this.call('GET', '/api/v1/auth/methods', undefined, null)).headers.get('x-front-burner-version');
  }

  /** Administrator onboarding, the login and the commit author: a fresh instance ready to work. */
  async onboard(): Promise<void> {
    const onboarded = await this.call('POST', '/api/v1/onboarding/password-setup', {
      setupToken: E2E_SETUP_TOKEN,
      ...E2E_ADMIN
    }, null);
    expect(onboarded.status).toBe(204);
    await this.login();
    expect((await this.call('PUT', '/api/v1/preferences/commit-author', AUTHOR)).status).toBe(200);
  }

  async login(): Promise<void> {
    const login = await this.call('POST', '/api/v1/auth/login', {
      email: E2E_ADMIN.email,
      password: E2E_ADMIN.password,
      refreshTokenDelivery: 'body'
    }, null);
    expect(login.status).toBe(200);
    this.authToken = login.body['authToken'] as string;
  }

  async repositories(): Promise<Summary[]> {
    return (await this.call('GET', '/api/v1/repositories/recent')).body['repositories'] as Summary[];
  }

  async statusOf(id: number): Promise<Summary | undefined> {
    return (await this.repositories()).find(summary => summary.id === id);
  }

  /** Starts adding a repository; gives its ID without waiting for the clone. */
  async startAdding(name: string, remoteUrl: string): Promise<number> {
    const added = await this.call('POST', '/api/v1/repositories', {
      remoteUrl,
      name,
      credentials: { mode: 'none' },
      cloneMode: 'full'
    });
    expect(added.status).toBe(201);
    return added.body['id'] as number;
  }

  /** Adds a repository and waits for its clone to be ready. */
  async add(name: string, remoteUrl: string): Promise<number> {
    const id = await this.startAdding(name, remoteUrl);
    await waitFor(async () => (await this.statusOf(id))?.status !== 'cloning');
    expect(await this.statusOf(id)).toMatchObject({ status: 'ready', error: null });
    return id;
  }

  save(id: number, path: string, content: string): Promise<Answer> {
    return this.call('PUT', `/api/v1/repositories/${id}/file`, { path, content, lineEnding: 'lf', bom: false });
  }

  async read(id: number, path: string): Promise<unknown> {
    const read = await this.call('GET', `/api/v1/repositories/${id}/file?path=${encodeURIComponent(path)}`);
    expect(read.status).toBe(200);
    return read.body['content'];
  }

  async startPull(id: number): Promise<number> {
    const started = await this.call('POST', `/api/v1/repositories/${id}/git/pull`);
    expect(started.status).toBe(202);
    return started.body['jobId'] as number;
  }

  async job(id: number, jobId: number): Promise<JobState> {
    const job = await this.call('GET', `/api/v1/repositories/${id}/git/jobs/${jobId}`);
    expect(job.status).toBe(200);
    return job.body as unknown as JobState;
  }

  async pulled(id: number): Promise<JobState> {
    const jobId = await this.startPull(id);
    let state = await this.job(id, jobId);
    await waitFor(async () => {
      state = await this.job(id, jobId);
      return state.status !== 'queued' && state.status !== 'running';
    });
    return state;
  }

  async gitStatus(id: number): Promise<Record<string, unknown>> {
    const status = await this.call('GET', `/api/v1/repositories/${id}/git/status`);
    expect(status.status).toBe(200);
    return status.body;
  }
}

/** The working copy of repository `id` in the container: `/data/repos/<user>/<id>`. */
async function workingCopy(container: Container, id: number): Promise<string> {
  return (await container.exec('sh', '-c', `echo /data/repos/*/${id}`)).trim();
}

/** `git` as the instance's UID in the running container, with the test's commit author. */
function gitIn(container: Container, cwd: string, ...args: string[]): Promise<string> {
  return container.exec(
    'git',
    '-C',
    cwd,
    '-c',
    `user.name=${AUTHOR.name}`,
    '-c',
    `user.email=${AUTHOR.email}`,
    ...args
  );
}

/** `sh -c` in a one-off container while the instance is stopped; fails the test when it fails. */
async function whileStopped(container: Container, script: string): Promise<string> {
  const result = await container.run([ 'sh', '-c', script ]);
  expect(result, result.stderr).toMatchObject({ exitCode: 0 });
  return result.stdout;
}

/** Removes a temporary folder, if the setup got as far as making it. */
function removeFolder(path: string | undefined): void {
  if (path !== undefined) {
    rmSync(path, { recursive: true, force: true });
  }
}

/** Closes what a describe opened; every step runs even when an earlier one fails. */
async function closeAll(...steps: (Promise<unknown> | undefined)[]): Promise<void> {
  const results = await Promise.allSettled(steps);
  const failed = results.find(result => result.status === 'rejected');
  if (failed !== undefined) {
    throw failed.reason;
  }
}

/** Bare remotes under a temporary folder, served over HTTPS on `127.0.0.1`. */
async function startRemotes(
  names: string[]
): Promise<{ root: string; git: GitHttpServer; bare: Record<string, string>; }> {
  const root = mkdtempSync(join(tmpdir(), 'front-burner-e2e-resilience-git-'));
  const { handbook } = createRemotes(root);
  pushFileFromElsewhere(handbook, 'README.md', '# Handbook\n');
  const bare = Object.fromEntries(names.map(name => [ name, copyRemote(root, handbook, name) ]));
  const git = await startGitHttpServer({
    repositories: Object.fromEntries(Object.entries(bare).map(([ name, path ]) => [ `${name}.git`, path ]))
  });
  return { root, git, bare };
}

/** The database's own files and its snapshots: what Front Burner writes to `/data` besides the working copies. */
const DATA_FILE = /^\/data\/(db\/front-burner\.sqlite(-wal|-shm|-journal)?|backups\/[\w.+-]+\.sqlite)$/;

describe.skipIf(E2E_IMAGE === undefined)(
  'the release image\'s resilience (NF-6, NF-7, NF-9)',
  { timeout: SLOW_MS },
  () => {
    describe('kills', () => {
      let remotes: Awaited<ReturnType<typeof startRemotes>>;
      let proxy: HoldingProxy | undefined;
      let container: Container;
      let instance: Instance;
      let handbookId: number;

      beforeAll(async () => {
        remotes = await startRemotes([ 'handbook', 'held', 'cut-short', 'waiting' ]);
        // Restarted by the test, not by Docker, so that it can change the volume in between.
        container = await startContainer({ noRestart: true });
        instance = new Instance(container);
        await instance.onboard();
        handbookId = await instance.add('Handbook', `${remotes.git.url}/handbook.git`);
      }, SLOW_MS);

      afterAll(async () => {
        try {
          await closeAll(container?.remove(), proxy?.close(), remotes?.git.close());
        } finally {
          removeFolder(remotes?.root);
        }
      }, SLOW_MS);

      it('NF-9.5: a clone killed mid-way is failed and removed on start', async () => {
        const held = await startHoldingProxy(Number(new URL(remotes.git.url).port));
        proxy = held;
        const heldUrl = `https://127.0.0.1:${held.port}/held.git`;
        // Hold from the connection after the submit's access check, so that the clone waits (AR-49).
        const before = held.connections;
        const check = await instance.call('POST', '/api/v1/repositories/access-check', {
          remoteUrl: heldUrl,
          credentials: { mode: 'none' }
        });
        expect(check.status).toBe(200);
        const clonesConnection = held.connections + (held.connections - before);
        held.holdFrom(clonesConnection);
        const id = await instance.startAdding('Held', heldUrl);
        await waitFor(() => held.connections > clonesConnection);
        expect(await instance.statusOf(id)).toMatchObject({ status: 'cloning' });
        expect((await container.exec('ls', '-A', '/data/tmp')).trim()).not.toBe('');

        await container.kill();
        held.release();
        await container.start();

        expect(await instance.statusOf(id)).toMatchObject({ status: 'error', error: 'clone-failed' });
        // The partial clone is gone, and no working copy was made.
        expect((await container.exec('ls', '-A', '/data/tmp')).trim()).toBe('');
        expect((await container.exec('sh', '-c', `ls -d /data/repos/*/${id} 2>/dev/null || true`)).trim()).toBe('');
      });

      it('NF-9.5: a pull killed mid-merge is undone on start', async () => {
        const id = await instance.add('Cut short', `${remotes.git.url}/cut-short.git`);
        const root = await workingCopy(container, id);
        await gitIn(container, root, 'commit', '-q', '--allow-empty', '-m', 'mine');
        const recorded = (await gitIn(container, root, 'rev-parse', 'HEAD')).trim();
        pushFileFromElsewhere(remotes.bare['cut-short'] as string, 'theirs.md', 'theirs\n');
        // Hooks are off, but a filter runs: this one stops git while it writes
        // `theirs.md`, deep inside the merge, until the kill.
        await gitIn(container, root, 'config', 'filter.hold.smudge', 'touch /tmp/hold-merge.started && exec sleep 600');
        await container.exec('sh', '-c', `echo 'theirs.md filter=hold' > ${root}/.git/info/attributes`);

        const jobId = await instance.startPull(id);
        await waitFor(async () => (await container.exec('ls', '/tmp')).includes('hold-merge.started'));
        await container.kill();
        // With the container stopped, as an operator would find it after a crash: git left its lock.
        await whileStopped(
          container,
          `git -C ${root} config --unset filter.hold.smudge && rm ${root}/.git/info/attributes && test -e ${root}/.git/index.lock`
        );
        await container.start();
        await instance.login();

        expect(await instance.job(id, jobId)).toEqual({
          status: 'failed',
          outcome: { kind: 'failed', code: 'interrupted', params: {} }
        });
        // D-4.6: the branch exactly as before.
        expect((await gitIn(container, root, 'rev-parse', 'HEAD')).trim()).toBe(recorded);
        expect((await gitIn(container, root, 'status', '--porcelain')).trim()).toBe('');
        expect(await container.exec('sh', '-c', `ls -A ${root}/.git ${root}`)).not.toMatch(
          /index\.lock|MERGE_HEAD|theirs\.md/
        );
        // The user can simply pull again.
        expect((await instance.pulled(id)).outcome).toMatchObject({ kind: 'pulled', result: 'merged' });
        expect(await instance.read(id, 'theirs.md')).toBe('theirs\n');
      });

      it('NF-9.5: a merge waiting for resolution survives a kill', async () => {
        const id = await instance.add('Waiting', `${remotes.git.url}/waiting.git`);
        const root = await workingCopy(container, id);
        pushFileFromElsewhere(remotes.bare['waiting'] as string, 'both.md', 'theirs\n');
        expect((await instance.save(id, 'both.md', 'mine\n')).status).toBe(200);
        await gitIn(container, root, 'add', 'both.md');
        await gitIn(container, root, 'commit', '-q', '-m', 'mine');
        const recorded = (await gitIn(container, root, 'rev-parse', 'HEAD')).trim();
        expect((await instance.pulled(id)).outcome).toMatchObject({ kind: 'pulled', result: 'conflicted' });
        const markers = await instance.read(id, 'both.md');
        expect(markers).toContain('<<<<<<< main');

        await container.kill();
        await container.start();
        await instance.login();

        expect(await instance.gitStatus(id)).toMatchObject({ mergeInProgress: true });
        expect((await gitIn(container, root, 'rev-parse', 'refs/front-burner/pre-merge')).trim()).toBe(recorded);
        expect(await instance.read(id, 'both.md')).toBe(markers);
        const merge = await instance.call('GET', `/api/v1/repositories/${id}/git/merge`);
        expect(merge.status).toBe(200);
        expect(merge.body['files']).toMatchObject([ { path: 'both.md', resolved: false } ]);
      });

      it('NF-9.4: a stale index.lock is removed on start', async () => {
        const root = await workingCopy(container, handbookId);

        await container.kill();
        await whileStopped(container, `touch ${root}/.git/index.lock`);
        await container.start();
        await instance.login();

        expect(await container.exec('ls', '-A', `${root}/.git`)).not.toContain('index.lock');
        // git can write the index again: a save and a commit go through.
        expect((await instance.save(handbookId, 'README.md', '# Handbook\n\nAfter the kill.\n')).status).toBe(200);
        const committed = await instance.call('POST', `/api/v1/repositories/${handbookId}/git/commits`, {
          message: 'After the kill',
          paths: [ 'README.md' ]
        });
        expect(committed.status).toBe(201);
      });

      it('NF-10.1: the data volume holds no log file after the runs', async () => {
        // Every file outside the working copies is the database or one of its snapshots.
        const files =
          (await container.exec('find', '/data', '-path', '/data/repos', '-prune', '-o', '-type', 'f', '-print'))
            .trim()
            .split('\n')
            .filter(file => file !== '');
        expect(files.length).toBeGreaterThan(0);
        expect(files.filter(file => !DATA_FILE.test(file))).toEqual([]);
        // No log in a working copy either, but git's own reflogs.
        expect(
          (await container.exec('find', '/data/repos', '-name', '*.log', '-not', '-path', '*/.git/*')).trim()
        ).toBe('');
      });
    });

    describe('a full repositories volume', () => {
      let remotes: Awaited<ReturnType<typeof startRemotes>>;
      let container: Container;
      let instance: Instance;
      let id: number;
      /** More than a full `tmpfs` can still hold in its last page, under the 1 MB limit (NF-1.5). */
      const large = `# Handbook\n\n${'Saved on a full disk. '.repeat(12_000)}\n`;

      beforeAll(async () => {
        remotes = await startRemotes([ 'handbook' ]);
        container = await startContainer({ repositoriesTmpfs: true });
        instance = new Instance(container);
        await instance.onboard();
        id = await instance.add('Handbook', `${remotes.git.url}/handbook.git`);
        expect((await instance.save(id, 'README.md', '# Handbook\n\nSaved before.\n')).status).toBe(200);
      }, SLOW_MS);

      afterAll(async () => {
        try {
          await closeAll(container?.remove(), remotes?.git.close());
        } finally {
          removeFolder(remotes?.root);
        }
      }, SLOW_MS);

      it('NF-9.8: a full repositories volume refuses a save with storage-full and the file is unchanged', async () => {
        // `head` stops at "No space left on device"; the volume is then full.
        const free = await container.exec(
          'sh',
          '-c',
          'head -c 128M /dev/zero > /repositories/filler 2>/dev/null; df -k /repositories | tail -n 1'
        );
        expect(free.trim().split(/\s+/)[3]).toBe('0');

        const saved = await instance.save(id, 'README.md', large);

        expect(saved.status).toBe(507);
        expect(saved.body).toMatchObject({ code: 'storage-full' });
        expect(await instance.read(id, 'README.md')).toBe('# Handbook\n\nSaved before.\n');
        // As "Low and full disk" in the guide says.
        const errored = (await container.logs()).split('\n').filter(line => line.includes('request errored'));
        expect(errored.some(line => line.includes('507'))).toBe(true);
      });

      it('NF-9.8: space freed, the save goes through', async () => {
        await container.exec('rm', '/repositories/filler');

        expect((await instance.save(id, 'README.md', large)).status).toBe(200);
        expect(await instance.read(id, 'README.md')).toBe(large);
      });
    });

    describe('backup and restore, as the guide says', () => {
      let remotes: Awaited<ReturnType<typeof startRemotes>>;
      let archives: string;
      let source: Container;
      let instance: Instance;
      const restored: Container[] = [];
      let handbookId: number;
      let laterId: number;
      /** The newest daily snapshot, which holds the administrator and Handbook but not Later. */
      let snapshot: string;
      const savedAfterSnapshot = '# Handbook\n\nSaved after the snapshot.\n';

      const snapshots = async (): Promise<string[]> =>
        (await source.exec('ls', '/data/backups')).trim().split('\n').filter(name =>
          /^front-burner-.*\.sqlite$/.test(name)
        );

      /** Step 3 of "Backing up": `tar` in a one-off container, into `volume-backups/`. */
      const backUp = (archive: string): Promise<RunResult> =>
        source.run(
          [ 'tar', '-czf', `/volume-backups/${archive}`, '-C', '/data', '.' ],
          [ `${archives}:/volume-backups` ]
        );

      /**
       * "Restoring" into a new instance of its own: steps 1 and 3, step 4 with
       * `withSnapshot`, and step 5. Step 2, the secrets, holds: every container
       * of the suite has the same ones.
       */
      const restore = async (archive: string, withSnapshot?: string): Promise<Container> => {
        const target = await startContainer();
        restored.push(target);
        await target.stop();
        const unpacked = await target.run([
          'sh',
          '-c',
          `find /data -mindepth 1 -maxdepth 1 ! -name lost+found -exec rm -rf {} + \\
          && tar -xzf /volume-backups/${archive} -C /data`
        ], [ `${archives}:/volume-backups:ro` ]);
        expect(unpacked, unpacked.stderr).toMatchObject({ exitCode: 0 });
        if (withSnapshot !== undefined) {
          const listed = await target.run([ 'ls', '-l', '/data/backups' ]);
          expect(listed.stdout).toContain(withSnapshot);
          await whileStopped(
            target,
            `rm -f /data/db/front-burner.sqlite-wal /data/db/front-burner.sqlite-shm \\
          && cp /data/backups/${withSnapshot} /data/db/front-burner.sqlite`
          );
        }
        await target.start();
        return target;
      };

      beforeAll(async () => {
        remotes = await startRemotes([ 'handbook', 'later' ]);
        archives = mkdtempSync(join(tmpdir(), 'front-burner-e2e-volume-backups-'));
        // The guide gives the folder to UID 1000; the suite may not, so anyone may write.
        chmodSync(archives, 0o777);
        source = await startContainer();
        instance = new Instance(source);
        // A fresh instance writes its first snapshot a moment after it starts (plan 129).
        await waitFor(async () => (await snapshots()).length === 1);
        await instance.onboard();
        handbookId = await instance.add('Handbook', `${remotes.git.url}/handbook.git`);
        // As if a day had passed: the next start writes a snapshot with the administrator and Handbook.
        const [ first ] = await snapshots();
        await source.exec(
          'sh',
          '-c',
          `cd /data/backups && mv ${first} front-burner-2000-01-01T00-00-00Z-${
            first?.replace(/^front-burner-[\dT-]+Z-/, '')
          }`
        );
        await source.restart();
        await waitFor(async () => (await snapshots()).length === 2);
        snapshot = (await snapshots()).filter(name => !name.startsWith('front-burner-2000-')).at(0) as string;
        await instance.login();
        // After the snapshot: a working copy it does not know, and newer content in one it does.
        laterId = await instance.add('Later', `${remotes.git.url}/later.git`);
        expect((await instance.save(handbookId, 'README.md', savedAfterSnapshot)).status).toBe(200);
      }, SLOW_MS);

      afterAll(async () => {
        try {
          await closeAll(source?.remove(), ...restored.map(container => container.remove()), remotes?.git.close());
        } finally {
          removeFolder(remotes?.root);
          removeFolder(archives);
        }
      }, SLOW_MS);

      describe('a copy of the running instance', () => {
        let target: Container;
        let copy: Instance;

        beforeAll(async () => {
          const archive = 'front-burner-data-running.tar.gz';
          const backedUp = await backUp(archive);
          // Step 3: while the instance runs, tar may warn of files that changed or went; the archive is still written.
          expect([ 0, 1, 2 ], backedUp.stderr).toContain(backedUp.exitCode);
          // Any other message of tar's means the archive is not complete.
          const unexpected = backedUp.stderr.split('\n').filter(line =>
            line.startsWith('tar:')
            && !/file changed as we read it|No such file or directory|File removed before we read it|Exiting with failure status due to previous errors/
              .test(line)
          );
          expect(unexpected).toEqual([]);
          expect(existsSync(join(archives, archive))).toBe(true);
          target = await restore(archive, snapshot);
          copy = new Instance(target);
        }, SLOW_MS);

        it('NF-6.2: a copy of a running instance restores from its snapshot', async () => {
          // The snapshot's administrator logs in, and its repository is there with its newest saved content.
          await copy.login();
          expect(await copy.statusOf(handbookId)).toMatchObject({ name: 'Handbook', status: 'ready', error: null });
          expect(await copy.read(handbookId, 'README.md')).toBe(savedAfterSnapshot);
          // Every change to the database since the snapshot is lost.
          expect(await copy.statusOf(laterId)).toBeUndefined();
        });

        it('NF-6.4: a restore moves newer working copies to orphans', async () => {
          const [ orphan ] = (await target.exec('ls', '/data/orphans')).trim().split('\n');
          expect(orphan).toMatch(new RegExp(`^\\d+-${laterId}-\\d{4}-\\d\\d-\\d\\dT\\d\\d-\\d\\d-\\d\\dZ$`));
          expect(await target.exec('ls', `/data/orphans/${orphan}`)).toContain('README.md');
          expect(await target.logs()).toMatch(
            new RegExp(
              `Working copy of repository ${laterId} \\(user \\d+\\) has no repository; moved to orphans/${orphan}`
            )
          );
        });
      });

      it('NF-6.5: a stopped copy restores as it was', async () => {
        const archive = 'front-burner-data-stopped.tar.gz';
        // Steps 2 to 4 of "Backing up".
        await source.stop();
        const backedUp = await backUp(archive);
        await source.start();
        expect(backedUp.exitCode, backedUp.stderr).toBe(0);
        expect(backedUp.stderr).not.toContain('tar:');

        const target = await restore(archive);
        const copy = new Instance(target);

        await copy.login();
        expect(
          (await copy.repositories()).map(({ name, status }) => ({ name, status })).sort((a, b) =>
            a.name.localeCompare(b.name)
          )
        ).toEqual([ { name: 'Handbook', status: 'ready' }, { name: 'Later', status: 'ready' } ]);
        expect(await copy.read(handbookId, 'README.md')).toBe(savedAfterSnapshot);
        expect((await target.exec('ls', '-A', '/data/orphans')).trim()).toBe('');
      });
    });

    describe.skipIf(!UPGRADE_TEST)('an upgrade and going back, as the guide says', () => {
      let remotes: Awaited<ReturnType<typeof startRemotes>>;
      let newImage: string;
      let container: Container;
      let instance: Instance;
      let oldVersion: string;
      let beforeId: number;
      let afterId: number;

      const preUpgradeSnapshots = async (): Promise<string[]> =>
        (await container.run([ 'ls', '/data/backups' ])).stdout.trim().split('\n').filter(name =>
          name.startsWith('pre-upgrade-')
        );

      beforeAll(async () => {
        // The build first: it takes minutes, and nothing else needs to wait for it.
        newImage = await buildUpgradeImage(E2E_IMAGE as string);
        remotes = await startRemotes([ 'before', 'after' ]);
        container = await startContainer();
        instance = new Instance(container);
        oldVersion = await instance.version() ?? '';
        expect(oldVersion).not.toBe('');
        expect(oldVersion).not.toBe(UPGRADE_TEST_VERSION);
        await instance.onboard();
        beforeId = await instance.add('Before', `${remotes.git.url}/before.git`);
      }, BUILD_MS);

      afterAll(async () => {
        try {
          await closeAll(container?.remove(), remotes?.git.close(), removeImage(newImage));
        } finally {
          removeFolder(remotes?.root);
        }
      }, SLOW_MS);

      it('NF-7.1: an upgrade writes a pre-upgrade snapshot and migrates', async () => {
        // "Upgrading", step 4: the new image in compose.yaml, then `docker compose up -d`.
        await container.useImage(newImage);

        expect(await instance.version()).toBe(UPGRADE_TEST_VERSION);
        // Step 5: the snapshot, named after the old version, and the log line that names it.
        const [ snapshot ] = await preUpgradeSnapshots();
        // Named as the server names it: `safeVersion` keeps letters, digits, `_`, `.`, `+` and `-`.
        expect(snapshot?.startsWith(`pre-upgrade-v${safeVersion(oldVersion)}-`), snapshot).toBe(true);
        expect(snapshot).toMatch(/\.sqlite$/);
        expect(await container.logs()).toContain(
          `Upgrading the database from ${oldVersion} to ${UPGRADE_TEST_VERSION}; snapshot backups/${snapshot}`
        );
        // The throwaway migration ran.
        const tables = await container.exec(
          'node',
          '-e',
          'const db = new (require("better-sqlite3"))("/data/db/front-burner.sqlite", { readonly: true });'
            + 'console.log(db.prepare("SELECT name FROM sqlite_master WHERE type = \'table\'").pluck().all().join(","));'
        );
        expect(tables.trim().split(',')).toContain('upgrade_test');
        // The data made before the upgrade is there.
        await instance.login();
        expect(await instance.statusOf(beforeId)).toMatchObject({ name: 'Before', status: 'ready' });
        afterId = await instance.add('After', `${remotes.git.url}/after.git`);
      });

      it('NF-7.3: the old image refuses the upgraded database and starts from the pre-upgrade snapshot', async () => {
        // The old image on the upgraded volume stops, naming the database's version.
        await container.useImage(E2E_IMAGE as string, { expectFailedStart: true });
        const { State } = await container.exited();
        expect(State.ExitCode).toBe(1);
        expect(await container.logs()).toContain(
          `Database is from version ${UPGRADE_TEST_VERSION}; restore the pre-upgrade snapshot to go back`
        );

        // "Going back after an upgrade", steps 2 to 4.
        const [ snapshot ] = await preUpgradeSnapshots();
        expect(snapshot).toBeDefined();
        await whileStopped(
          container,
          `rm -f /data/db/front-burner.sqlite-wal /data/db/front-burner.sqlite-shm \\
        && cp /data/backups/${snapshot} /data/db/front-burner.sqlite`
        );
        await container.useImage(E2E_IMAGE as string);

        expect(await instance.version()).toBe(oldVersion);
        await instance.login();
        expect(await instance.statusOf(beforeId)).toMatchObject({ name: 'Before', status: 'ready' });
        // The repository added since the upgrade is gone, and its working copy is in orphans/.
        expect(await instance.statusOf(afterId)).toBeUndefined();
        expect((await container.exec('ls', '/data/orphans')).trim()).toMatch(new RegExp(`^\\d+-${afterId}-`));
      });
    });
  }
);
