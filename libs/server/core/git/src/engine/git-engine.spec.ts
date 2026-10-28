import { startHttpsTestServer, TEST_CERTIFICATE_FILES } from '@front-burner/server-core-security/testing';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import { AddressInfo, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GitCredentials } from '../broker/broker';
import type { GitOptions } from '../git.options';
import { GitRunner } from '../runner/git-runner';
import { fingerprintOf, unlockPrivateKey } from '../ssh/ssh-keys';
import { GitHttpServer, startGitHttpServer } from '../testing/git-http-server';
import { GitSshServer, startGitSshServer } from '../testing/git-ssh-server';
import { GitEngine } from './git-engine';
import { GitOperationError } from './git-errors';

const TOKEN = 'ghp_sup3r-s3cret-token-value';
const USER = 'x-access-token';
const HTTPS: GitCredentials = { kind: 'https', username: USER, password: TOKEN };
const NONE: GitCredentials = { kind: 'none' };

const gitEnv = {
  PATH: process.env['PATH'] ?? '/usr/bin:/bin',
  HOME: tmpdir(),
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_AUTHOR_NAME: 'Fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.com',
  GIT_COMMITTER_NAME: 'Fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.com'
};
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf8' });

/** A bare repository with `main` (two commits) and `feature/x`. */
function createFixture(root: string): string {
  const work = join(root, 'work');
  const bare = join(root, 'fixture.git');
  mkdirSync(work);
  git(root, 'init', '-q', '--bare', '-b', 'main', bare);
  git(work, 'init', '-q', '-b', 'main');
  git(work, 'commit', '-q', '--allow-empty', '-m', 'first');
  git(work, 'commit', '-q', '--allow-empty', '-m', 'second');
  git(work, 'branch', 'feature/x');
  git(work, 'push', '-q', bare, 'main', 'feature/x');
  return bare;
}

async function failureOf(promise: Promise<unknown>): Promise<GitOperationError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(GitOperationError);
    return error as GitOperationError;
  }
  throw new Error('the operation did not fail');
}

/** Every file under a folder, recursively. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .map(name => join(dir, name))
    .filter(path => statSync(path).isFile());
}

/** The command line and environment of every process this user can read, except this one. */
function sampleProcesses(): { pid: string; cmdline: string; environ: string; }[] {
  const samples: { pid: string; cmdline: string; environ: string; }[] = [];
  for (const pid of readdirSync('/proc')) {
    if (!/^\d+$/.test(pid) || Number(pid) === process.pid) {
      continue;
    }
    try {
      samples.push({
        pid,
        cmdline: readFileSync(`/proc/${pid}/cmdline`, 'latin1'),
        environ: readFileSync(`/proc/${pid}/environ`, 'latin1')
      });
    } catch {
      // Another user's process, or it ended meanwhile.
    }
  }
  return samples;
}

describe('GitEngine', () => {
  const savedCaInfo = process.env['GIT_SSL_CAINFO'];
  const runner = new GitRunner();
  let root: string;
  let tmpRoot: string;
  let server: GitHttpServer;
  let options: GitOptions;

  const engine = (overrides: Partial<GitOptions> = {}) => new GitEngine({ ...options, ...overrides }, runner);
  const serve = async (users?: Record<string, string>, delayMs?: number) => {
    await server.close();
    server = await startGitHttpServer({
      repositories: { 'fixture.git': join(root, 'fixture.git'), 'empty.git': join(root, 'empty.git') },
      users,
      delayMs
    });
    return server;
  };

  beforeAll(() => {
    process.env['GIT_SSL_CAINFO'] = TEST_CERTIFICATE_FILES.cert;
  });

  afterAll(() => {
    if (savedCaInfo === undefined) {
      delete process.env['GIT_SSL_CAINFO'];
    } else {
      process.env['GIT_SSL_CAINFO'] = savedCaInfo;
    }
  });

  beforeEach(async () => {
    process.env['GIT_SSL_CAINFO'] = TEST_CERTIFICATE_FILES.cert;
    root = mkdtempSync(join(tmpdir(), 'fb-engine-spec-'));
    tmpRoot = join(root, 'tmp');
    mkdirSync(tmpRoot);
    mkdirSync(join(root, 'repos'));
    createFixture(root);
    git(root, 'init', '-q', '--bare', '-b', 'main', join(root, 'empty.git'));
    options = {
      helpersDir: join(__dirname, '../../helpers'),
      egress: { blockPrivateNetworks: false },
      cloneTimeoutMs: 60_000,
      gitTimeoutMs: 60_000,
      knownHosts: []
    };
    server = await startGitHttpServer({
      repositories: { 'fixture.git': join(root, 'fixture.git'), 'empty.git': join(root, 'empty.git') }
    });
  });

  afterEach(async () => {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  });

  describe('accessCheck', () => {
    it('lists the branches and the default branch', async () => {
      const result = await engine().accessCheck(`${server.url}/fixture.git`, NONE);

      expect(result).toEqual({ branches: [ 'feature/x', 'main' ], defaultBranch: 'main' });
    });

    it('checks an empty remote', async () => {
      const result = await engine().accessCheck(`${server.url}/empty.git`, NONE);

      expect(result).toEqual({ branches: [], defaultBranch: undefined });
    });

    it('checks access with a username and token', async () => {
      const running = await serve({ [USER]: TOKEN });

      const result = await engine().accessCheck(`${running.url}/fixture.git`, HTTPS);

      expect(result.branches).toEqual([ 'feature/x', 'main' ]);
    });

    it('reports wrong credentials as auth-failed', async () => {
      const running = await serve({ [USER]: TOKEN });

      const error = await failureOf(
        engine().accessCheck(`${running.url}/fixture.git`, { ...HTTPS, password: 'wrong-token' })
      );

      expect(error.code).toBe('auth-failed');
    });

    it('reports a private repository without credentials as auth-failed', async () => {
      const running = await serve({ [USER]: TOKEN });

      const error = await failureOf(engine().accessCheck(`${running.url}/fixture.git`, NONE));

      expect(error.code).toBe('auth-failed');
    });

    it('reports a missing repository as repository-not-found', async () => {
      const error = await failureOf(engine().accessCheck(`${server.url}/missing.git`, NONE));

      expect(error.code).toBe('repository-not-found');
    });

    it('reports an untrusted certificate', async () => {
      delete process.env['GIT_SSL_CAINFO'];

      const error = await failureOf(engine().accessCheck(`${server.url}/fixture.git`, NONE));

      expect(error.code).toBe('tls-untrusted');
    });

    it('reports a closed port as host-unreachable', async () => {
      const closed = createServer();
      await new Promise<void>(resolve => closed.listen(0, '127.0.0.1', resolve));
      const { port } = closed.address() as AddressInfo;
      await new Promise(resolve => closed.close(resolve));

      const error = await failureOf(engine().accessCheck(`https://127.0.0.1:${port}/fixture.git`, NONE));

      expect(error.code).toBe('host-unreachable');
      expect(error.params).toEqual({ host: '127.0.0.1' });
    });

    it('refuses loopback with the switch as host-unreachable', async () => {
      const error = await failureOf(
        engine({ egress: { blockPrivateNetworks: true } }).accessCheck(`${server.url}/fixture.git`, NONE)
      );

      expect(error.code).toBe('host-unreachable');
    });

    it('refuses a redirect to a blocked address', async () => {
      const redirecting = await startHttpsTestServer((_request, response) => {
        response.writeHead(302, { Location: 'https://169.254.169.254/x' });
        response.end();
      });
      try {
        const error = await failureOf(engine().accessCheck(`${redirecting.url}/fixture.git`, HTTPS));

        expect(error.code).toBe('host-unreachable');
      } finally {
        await redirecting.close();
      }
    });

    it('refuses a remote URL that is not https', async () => {
      const error = await failureOf(engine().accessCheck('file:///etc', NONE));

      expect(error.code).toBe('failed');
    });
  });

  describe('mergeInProgress', () => {
    it('reports a merge in progress', async () => {
      const work = join(root, 'merging');
      mkdirSync(work);
      git(work, 'init', '-q', '-b', 'main');
      writeFileSync(join(work, 'notes.md'), 'base\n');
      git(work, 'add', 'notes.md');
      git(work, 'commit', '-q', '-m', 'base');
      git(work, 'checkout', '-q', '-b', 'other');
      writeFileSync(join(work, 'notes.md'), 'theirs\n');
      git(work, 'commit', '-q', '-am', 'theirs');
      git(work, 'checkout', '-q', 'main');
      writeFileSync(join(work, 'notes.md'), 'ours\n');
      git(work, 'commit', '-q', '-am', 'ours');

      expect(await engine().mergeInProgress(work)).toBe(false);
      expect(() => git(work, 'merge', '-q', 'other')).toThrow();
      expect(await engine().mergeInProgress(work)).toBe(true);
      git(work, 'merge', '--abort');
      expect(await engine().mergeInProgress(work)).toBe(false);
    });
  });

  describe('folder queries', () => {
    let work: string;

    beforeEach(() => {
      work = join(root, 'folders');
      mkdirSync(join(work, 'build'), { recursive: true });
      git(work, 'init', '-q', '-b', 'main');
      writeFileSync(join(work, '.gitignore'), 'build/\n*.log\n');
      writeFileSync(join(work, 'keep.log'), 'kept\n');
      git(work, 'add', '-f', '.gitignore', 'keep.log');
      git(work, 'commit', '-q', '-m', 'base');
      writeFileSync(join(work, 'out.log'), 'out\n');
      writeFileSync(join(work, 'build', 'app.js'), '\n');
      writeFileSync(join(work, 'notes.md'), '\n');
      const sha = git(work, 'rev-parse', 'HEAD').trim();
      git(work, 'update-index', '--add', '--cacheinfo', `160000,${sha},vendor/lib`);
    });

    it('reports ignored untracked paths', async () => {
      const ignored = await engine().ignoredAmong(work, [ 'out.log', 'build', 'notes.md', '.gitignore' ]);
      expect([ ...ignored ].sort()).toEqual([ 'build', 'out.log' ]);
    });

    it('does not report tracked files', async () => {
      expect(await engine().ignoredAmong(work, [ 'keep.log' ])).toEqual(new Set());
    });

    it('returns an empty set for no paths', async () => {
      expect(await engine().ignoredAmong(join(root, 'missing'), [])).toEqual(new Set());
    });

    it('handles names with newlines and quotes', async () => {
      const names = [ 'a\nb.log', 'say "hi".log', 'café\t.log', 'plain.md' ];
      for (const name of names) {
        writeFileSync(join(work, name), '\n');
      }
      const ignored = await engine().ignoredAmong(work, names);
      expect([ ...ignored ].sort()).toEqual([ 'a\nb.log', 'café\t.log', 'say "hi".log' ]);
    });

    it('takes names that look like pathspec magic literally', async () => {
      const names = [ ':!draft.md', ':^notes.md', ':x.log', ':(glob)*.md' ];
      for (const name of names) {
        writeFileSync(join(work, name), '\n');
      }
      expect([ ...await engine().ignoredAmong(work, names) ]).toEqual([ ':x.log' ]);
      expect(await engine().ignoredIn(work, '')).toEqual(new Set([ ':x.log', 'build', 'out.log' ]));
    });

    it('lists the ignored entries directly inside a folder', async () => {
      git(work, 'add', '-f', 'build/app.js');
      writeFileSync(join(work, 'build', 'other.js'), '\n');
      mkdirSync(join(work, 'logs', 'deep'), { recursive: true });
      writeFileSync(join(work, 'logs', 'a.log'), '\n');
      writeFileSync(join(work, 'logs', 'deep', 'b.log'), '\n');
      writeFileSync(join(work, 'logs', 'c.md'), '\n');

      expect(await engine().ignoredIn(work, '')).toEqual(new Set([ 'out.log' ]));
      expect(await engine().ignoredIn(work, 'build')).toEqual(new Set([ 'other.js' ]));
      expect(await engine().ignoredIn(work, 'logs')).toEqual(new Set([ 'a.log' ]));
    });

    it('throws when git fails', async () => {
      await expect(engine().ignoredAmong(work, [ '../outside' ])).rejects.toThrow();
    });

    it('lists gitlinks directly inside a folder', async () => {
      expect(await engine().gitlinksIn(work, 'vendor')).toEqual(new Set([ 'lib' ]));
      expect(await engine().gitlinksIn(work, '')).toEqual(new Set());
    });

    it('does not report a tracked file inside an ignored folder', async () => {
      git(work, 'add', '-f', 'build/app.js');
      writeFileSync(join(work, 'build', 'other.js'), '\n');
      const ignored = await engine().ignoredAmong(work, [ 'build/app.js', 'build/other.js' ]);
      expect([ ...ignored ]).toEqual([ 'build/other.js' ]);
    });

    it('treats glob characters in the folder name literally', async () => {
      const sha = git(work, 'rev-parse', 'HEAD').trim();
      git(work, 'update-index', '--add', '--cacheinfo', `160000,${sha},v[e]ndor*/mod`);
      expect(await engine().gitlinksIn(work, 'v[e]ndor*')).toEqual(new Set([ 'mod' ]));
      expect(await engine().gitlinksIn(work, 'vendor')).toEqual(new Set([ 'lib' ]));
    });

    it('counts untracked and ignored files but not modified tracked ones', async () => {
      writeFileSync(join(work, 'keep.log'), 'changed\n');
      // out.log and build/app.js are ignored, notes.md untracked.
      expect(await engine().uncommittedUnder(work, '')).toBe(3);
      expect(await engine().uncommittedUnder(work, 'build')).toBe(1);
      expect(await engine().uncommittedUnder(work, 'keep.log')).toBe(0);
      expect(await engine().uncommittedUnder(work, 'notes.md')).toBe(1);
    });

    it('counts files in untracked folders one by one', async () => {
      mkdirSync(join(work, 'drafts', 'deep'), { recursive: true });
      writeFileSync(join(work, 'drafts', 'a.md'), '\n');
      writeFileSync(join(work, 'drafts', 'deep', 'b.md'), '\n');
      writeFileSync(join(work, 'build', 'other.js'), '\n');
      expect(await engine().uncommittedUnder(work, 'drafts')).toBe(2);
      expect(await engine().uncommittedUnder(work, 'build')).toBe(2);
    });

    it('takes a path that looks like pathspec magic literally', async () => {
      mkdirSync(join(work, ':(glob)*'));
      writeFileSync(join(work, ':(glob)*', 'a.md'), '\n');
      expect(await engine().uncommittedUnder(work, ':(glob)*')).toBe(1);
    });

    it('does not write the index while counting', async () => {
      // A changed modification time makes git refresh the index, and write it when it may take the lock.
      utimesSync(join(work, 'keep.log'), new Date(2000, 0, 1), new Date(2000, 0, 1));
      const before = readFileSync(join(work, '.git', 'index'));

      await engine().uncommittedUnder(work, '');

      expect(readFileSync(join(work, '.git', 'index')).equals(before)).toBe(true);
    });

    it('counts nothing in a nested repository', async () => {
      mkdirSync(join(work, 'drafts', 'old'), { recursive: true });
      git(join(work, 'drafts', 'old'), 'init', '-q');
      writeFileSync(join(work, 'drafts', 'old', 'a.md'), '\n');
      writeFileSync(join(work, 'drafts', 'b.md'), '\n');
      expect(await engine().uncommittedUnder(work, 'drafts')).toBe(1);
    });

    it('skips the source path of a rename in the working tree', async () => {
      writeFileSync(join(work, '?? old.md'), 'old\n');
      git(work, 'add', '?? old.md');
      git(work, 'commit', '-q', '-m', 'old');
      git(work, 'mv', '?? old.md', 'new.md');
      git(work, 'reset', '-q');
      git(work, 'add', '-N', 'new.md');
      expect(git(work, 'status', '--porcelain=v1', '--', 'new.md', '?? old.md')).toMatch(/^ R /);

      // out.log, build/app.js and notes.md, as before.
      expect(await engine().uncommittedUnder(work, '')).toBe(3);
    });

    it('finds the submodule on a path', async () => {
      expect(await engine().submoduleOn(work, 'vendor/lib/docs/a.md')).toBe('vendor/lib');
      expect(await engine().submoduleOn(work, 'vendor/lib')).toBe('vendor/lib');
      expect(await engine().submoduleOn(work, 'vendor')).toBeNull();
      expect(await engine().submoduleOn(work, 'vendor/library/a.md')).toBeNull();
      expect(await engine().submoduleOn(work, 'build/app.js')).toBeNull();
      expect(await engine().submoduleOn(work, '')).toBeNull();
    });

    it('checks a folder path that does not exist yet against a folder rule', async () => {
      const ignored = await engine().ignoredAmong(work, [ 'sub/build/', 'sub/build' ]);
      expect([ ...ignored ]).toEqual([ 'sub/build/' ]);
    });
  });

  describe('clone', () => {
    const clone = (overrides: Partial<Parameters<GitEngine['clone']>[0]> = {}, gitOptions?: Partial<GitOptions>) =>
      engine(gitOptions).clone({
        remoteUrl: `${server.url}/fixture.git`,
        credentials: NONE,
        mode: 'full',
        tmpRoot,
        destination: join(root, 'repos', 'one'),
        ...overrides
      });

    it('clones every branch', async () => {
      await clone();

      const destination = join(root, 'repos', 'one');
      expect(git(destination, 'branch', '-r').split('\n').map(line => line.trim())).toEqual(
        expect.arrayContaining([ 'origin/feature/x', 'origin/main' ])
      );
      expect(git(destination, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('main');
      expect(readdirSync(tmpRoot)).toEqual([]);
    });

    it('clones a single branch at depth 1', async () => {
      await clone({ mode: 'single-branch', branch: 'feature/x' });

      const destination = join(root, 'repos', 'one');
      expect(git(destination, 'rev-list', '--count', 'HEAD').trim()).toBe('1');
      expect(git(destination, 'branch', '-r').trim()).toBe('origin/feature/x');
      expect(git(destination, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('feature/x');
    });

    it('clones with a username and token, and keeps them out of the working copy', async () => {
      const running = await serve({ [USER]: TOKEN });

      await clone({ remoteUrl: `${running.url}/fixture.git`, credentials: HTTPS });

      const config = readFileSync(join(root, 'repos', 'one', '.git', 'config'), 'utf8');
      expect(config).toContain(`url = ${running.url}/fixture.git`);
      expect(config).not.toContain(USER);
    });

    it('reports a missing branch as branch-not-found', async () => {
      const error = await failureOf(clone({ mode: 'single-branch', branch: 'nope' }));

      expect(error.code).toBe('branch-not-found');
      expect(error.params).toEqual({ host: '127.0.0.1', branch: 'nope' });
    });

    it('leaves nothing behind when a clone fails', async () => {
      const error = await failureOf(clone({ remoteUrl: `${server.url}/missing.git` }));

      expect(error.code).toBe('repository-not-found');
      expect(readdirSync(tmpRoot)).toEqual([]);
      expect(existsSync(join(root, 'repos', 'one'))).toBe(false);
    });

    it('stops a clone at the timeout', async () => {
      const stalling = await startHttpsTestServer(() => undefined);
      try {
        const started = Date.now();

        const error = await failureOf(
          clone({ remoteUrl: `${stalling.url}/fixture.git` }, { cloneTimeoutMs: 500 })
        );

        expect(error.code).toBe('timeout');
        expect(Date.now() - started).toBeLessThan(5_000);
        expect(readdirSync(tmpRoot)).toEqual([]);
        expect(existsSync(join(root, 'repos', 'one'))).toBe(false);
      } finally {
        await stalling.close();
      }
    });

    it('keeps the password out of git\'s arguments, environment and files', async () => {
      const running = await serve({ [USER]: TOKEN }, 300);
      const encoded = [
        TOKEN,
        Buffer.from(`${USER}:${TOKEN}`).toString('base64'),
        encodeURIComponent(TOKEN)
      ];
      const leaks: string[] = [];
      const seen = new Set<string>();
      const brokerFiles: string[] = [];
      let sampling = true;
      const sampler = (async () => {
        while (sampling) {
          for (const sample of sampleProcesses()) {
            if (/git/.test(sample.cmdline) && sample.environ.includes('FB_BROKER_TOKEN')) {
              seen.add(sample.cmdline.split('\0')[0] ?? '');
            }
            for (const text of encoded) {
              if (sample.cmdline.includes(text) || sample.environ.includes(text)) {
                leaks.push(`${sample.pid}: ${sample.cmdline.replace(/\0/g, ' ')}`);
              }
            }
          }
          for (const dir of readdirSync(tmpdir()).filter(name => name.startsWith('fb-broker-'))) {
            try {
              brokerFiles.push(...filesUnder(join(tmpdir(), dir)));
            } catch {
              // Removed meanwhile.
            }
          }
          await new Promise(resolve => setTimeout(resolve, 5));
        }
      })();

      try {
        await clone({ remoteUrl: `${running.url}/fixture.git`, credentials: HTTPS });
      } finally {
        sampling = false;
        await sampler;
      }

      expect(leaks).toEqual([]);
      // The sampler did see git and its HTTPS helper while they ran.
      expect([ ...seen ].some(name => name.endsWith('git'))).toBe(true);
      expect([ ...seen ].some(name => name.includes('remote-https'))).toBe(true);
      expect(brokerFiles).toEqual([]);
      for (const file of filesUnder(join(root, 'repos', 'one'))) {
        const content = readFileSync(file, 'latin1');
        for (const text of encoded) {
          expect(content.includes(text), file).toBe(false);
        }
      }
    });
  });

  describe('over SSH', () => {
    const KEYS = join(__dirname, '../testing/fixtures/keys');
    const keyText = (name: string) => readFileSync(join(KEYS, name), 'utf8');
    const SSH: GitCredentials = { kind: 'ssh', key: unlockPrivateKey(keyText('ed25519')) };
    let ssh: GitSshServer;

    const startSsh = async (delayMs?: number) => {
      await ssh?.close();
      ssh = await startGitSshServer({
        repositories: { 'fixture.git': join(root, 'fixture.git') },
        authorizedKeys: [ keyText('ed25519.pub') ],
        delayMs
      });
      return ssh;
    };
    const url = () => `ssh://git@127.0.0.1:${ssh.port}/fixture.git`;
    const clone = (overrides: Partial<Parameters<GitEngine['clone']>[0]> = {}, gitOptions?: Partial<GitOptions>) =>
      engine(gitOptions).clone({
        remoteUrl: url(),
        credentials: SSH,
        mode: 'full',
        tmpRoot,
        destination: join(root, 'repos', 'one'),
        knownHosts: [ ssh.hostKeyLine ],
        ...overrides
      });

    beforeEach(async () => {
      await startSsh();
    });

    afterEach(async () => {
      await ssh.close();
    });

    it('checks access over SSH with an unlocked key', async () => {
      const result = await engine().accessCheck(url(), SSH, [ ssh.hostKeyLine ]);

      expect(result).toEqual({ branches: [ 'feature/x', 'main' ], defaultBranch: 'main' });
    });

    it('trusts the instance-wide known hosts', async () => {
      const result = await engine({ knownHosts: [ ssh.hostKeyLine ] }).accessCheck(url(), SSH);

      expect(result.defaultBranch).toBe('main');
    });

    it('clones every branch over SSH', async () => {
      await clone();
      const destination = join(root, 'repos', 'one');

      expect(git(destination, 'branch', '-r').split('\n').map(line => line.trim())).toEqual(
        expect.arrayContaining([ 'origin/main', 'origin/feature/x' ])
      );
      expect(git(destination, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('main');
    });

    it('clones a single branch over SSH', async () => {
      await clone({ mode: 'single-branch', branch: 'feature/x' });
      const destination = join(root, 'repos', 'one');

      expect(git(destination, 'rev-list', '--count', 'HEAD').trim()).toBe('1');
      expect(git(destination, 'branch', '-r').trim()).toBe('origin/feature/x');
    });

    it('reports an unknown host key with its fingerprint', async () => {
      const error = await failureOf(engine().accessCheck(url(), SSH, []));
      const [ , type, key ] = ssh.hostKeyLine.split(' ');

      expect(error.code).toBe('host-key-unknown');
      expect(error.params).toEqual({
        host: '127.0.0.1',
        port: String(ssh.port),
        type,
        key,
        fingerprint: fingerprintOf(`${type} ${key}`)
      });
      expect(ssh.refusedLogins).toBe(0);
    });

    it('tells a changed host key from an unknown one', async () => {
      const other = keyText('ed25519-passphrase.pub').trim().split(' ');
      const error = await failureOf(
        engine().accessCheck(url(), SSH, [ `[127.0.0.1]:${ssh.port} ${other[0]} ${other[1]}` ])
      );

      expect(error.code).toBe('host-key-changed');
    });

    it('reports a host key of another type than the known one as changed', async () => {
      const other = keyText('rsa-2048.pub').trim().split(' ');
      const error = await failureOf(
        engine().accessCheck(url(), SSH, [ `[127.0.0.1]:${ssh.port} ${other[0]} ${other[1]}` ])
      );

      expect(error.code).toBe('host-key-changed');
    });

    it('does not trust the same host on another port', async () => {
      const [ , type, key ] = ssh.hostKeyLine.split(' ');
      const error = await failureOf(
        engine().accessCheck(url(), SSH, [ `[127.0.0.1]:${ssh.port + 1} ${type} ${key}` ])
      );

      expect(error.code).toBe('host-key-unknown');
    });

    it('reports a key the server does not accept as auth-failed', async () => {
      const other: GitCredentials = { kind: 'ssh', key: unlockPrivateKey(keyText('ecdsa-p256')) };
      const error = await failureOf(engine().accessCheck(url(), other, [ ssh.hostKeyLine ]));

      expect(error.code).toBe('auth-failed');
    });

    it('refuses a blocked address over SSH', async () => {
      const error = await failureOf(
        engine({ egress: { blockPrivateNetworks: true } }).accessCheck(url(), SSH, [ ssh.hostKeyLine ])
      );

      expect(error.code).toBe('host-unreachable');
    });

    it('refuses HTTPS credentials for an SSH remote', async () => {
      const error = await failureOf(engine().accessCheck(url(), HTTPS, [ ssh.hostKeyLine ]));

      expect(error.code).toBe('failed');
    });

    it('keeps the private key out of files and the environment', async () => {
      await startSsh(300);
      // The base64 lines of the private key file, and the key's private part.
      const secrets = keyText('ed25519').split('\n').filter(line => /^[A-Za-z0-9+/=]{40,}$/.test(line));
      expect(secrets.length).toBeGreaterThan(2);
      const leaks: string[] = [];
      const seen = new Set<string>();
      const brokerFiles = new Map<string, string>();
      let sampling = true;
      const sampler = (async () => {
        while (sampling) {
          for (const sample of sampleProcesses()) {
            if (sample.environ.includes('FB_BROKER_TOKEN')) {
              seen.add(sample.cmdline.split('\0')[0] ?? '');
            }
            for (const text of secrets) {
              if (sample.cmdline.includes(text) || sample.environ.includes(text)) {
                leaks.push(`${sample.pid}: ${sample.cmdline.replace(/\0/g, ' ')}`);
              }
            }
          }
          for (const dir of readdirSync(tmpdir()).filter(name => name.startsWith('fb-broker-'))) {
            try {
              for (const file of filesUnder(join(tmpdir(), dir))) {
                brokerFiles.set(file, readFileSync(file, 'latin1'));
              }
            } catch {
              // Removed meanwhile.
            }
          }
          await new Promise(resolve => setTimeout(resolve, 5));
        }
      })();

      try {
        await clone();
      } finally {
        sampling = false;
        await sampler;
      }

      expect(leaks).toEqual([]);
      // The sampler did see git and ssh while they ran, and the broker's files.
      expect([ ...seen ].some(name => name.endsWith('ssh'))).toBe(true);
      expect([ ...brokerFiles.keys() ].some(file => file.endsWith('ssh_config'))).toBe(true);
      for (const [ file, content ] of brokerFiles) {
        for (const text of secrets) {
          expect(content.includes(text), file).toBe(false);
        }
      }
    });
  });
});
