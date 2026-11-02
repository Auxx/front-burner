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

  describe('status', () => {
    let work: string;

    const changes = async () => (await engine().status(work)).changes;

    /** A clone of the fixture on `main`, with a tracked file. */
    const cloneFixture = () => {
      git(root, 'clone', '-q', join(root, 'fixture.git'), work);
      writeFileSync(join(work, 'notes.md'), 'base\n');
      git(work, 'add', 'notes.md');
      git(work, 'commit', '-q', '-m', 'notes');
      git(work, 'push', '-q', 'origin', 'main');
    };

    beforeEach(() => {
      work = join(root, 'status');
    });

    describe('in a repository with commits', () => {
      beforeEach(() => {
        mkdirSync(join(work, 'docs'), { recursive: true });
        git(work, 'init', '-q', '-b', 'main');
        writeFileSync(join(work, '.gitignore'), '*.log\n');
        writeFileSync(join(work, 'b.md'), 'b\n');
        writeFileSync(join(work, 'gone.md'), 'gone\n');
        writeFileSync(join(work, 'docs', 'a.md'), 'a\n');
        git(work, 'add', '.');
        git(work, 'commit', '-q', '-m', 'base');
      });

      it('lists modified, added and deleted files, sorted by path', async () => {
        writeFileSync(join(work, 'b.md'), 'changed\n');
        writeFileSync(join(work, 'docs', 'a.md'), 'changed\n');
        writeFileSync(join(work, 'docs', 'new.md'), 'new\n');
        writeFileSync(join(work, 'a-new.png'), 'new\n');
        rmSync(join(work, 'gone.md'));

        expect(await changes()).toEqual([
          { path: 'a-new.png', state: 'added' },
          { path: 'b.md', state: 'modified' },
          { path: 'docs/a.md', state: 'modified' },
          { path: 'docs/new.md', state: 'added' },
          { path: 'gone.md', state: 'deleted' }
        ]);
      });

      it('has no changes in a clean working copy', async () => {
        expect(await changes()).toEqual([]);
      });

      it('does not list an ignored file', async () => {
        writeFileSync(join(work, 'out.log'), 'ignored\n');
        expect(await changes()).toEqual([]);
      });

      it('reports a rename as one deleted and one added file', async () => {
        git(work, 'mv', 'b.md', 'c.md');
        expect(await changes()).toEqual([ { path: 'b.md', state: 'deleted' }, { path: 'c.md', state: 'added' } ]);
      });

      it('reads paths with special characters as they are', async () => {
        const paths = [ '"quoted".md', 'line\nbreak.md', 'tab\there.md', 'файл é 😀.md', '? odd.md', '1 .M x.md' ];
        for (const path of paths) {
          writeFileSync(join(work, path), 'tracked\n');
        }
        git(work, 'add', '.');
        git(work, 'commit', '-q', '-m', 'odd names');
        for (const path of paths) {
          writeFileSync(join(work, path), 'changed\n');
          writeFileSync(join(work, `new ${path}`), 'new\n');
        }

        const expected = paths.flatMap(path => [
          { path, state: 'modified' },
          { path: `new ${path}`, state: 'added' }
        ]);
        expected.sort((a, b) => (a.path < b.path ? -1 : 1));
        expect(await changes()).toEqual(expected);
      });

      it('leaves out a nested repository', async () => {
        mkdirSync(join(work, 'drafts', 'old'), { recursive: true });
        git(join(work, 'drafts', 'old'), 'init', '-q');
        writeFileSync(join(work, 'drafts', 'old', 'a.md'), '\n');
        writeFileSync(join(work, 'drafts', 'b.md'), '\n');

        expect(await changes()).toEqual([ { path: 'drafts/b.md', state: 'added' } ]);
      });

      it('reports a conflict as modified', async () => {
        git(work, 'checkout', '-q', '-b', 'other');
        writeFileSync(join(work, 'b.md'), 'theirs\n');
        git(work, 'commit', '-q', '-am', 'theirs');
        git(work, 'checkout', '-q', 'main');
        writeFileSync(join(work, 'b.md'), 'ours\n');
        git(work, 'commit', '-q', '-am', 'ours');
        expect(() => git(work, 'merge', '-q', 'other')).toThrow();

        expect(await changes()).toEqual([ { path: 'b.md', state: 'modified' } ]);
      });

      it('does not touch the index file', async () => {
        // A changed modification time makes git refresh the index, and write it when it may take the lock.
        utimesSync(join(work, 'b.md'), new Date(2000, 0, 1), new Date(2000, 0, 1));
        const before = readFileSync(join(work, '.git', 'index'));

        await engine().status(work);

        expect(readFileSync(join(work, '.git', 'index')).equals(before)).toBe(true);
      });
    });

    it('reports the branch, upstream and counts', async () => {
      cloneFixture();
      git(work, 'reset', '-q', '--hard', 'HEAD~1');
      git(work, 'commit', '-q', '--allow-empty', '-m', 'one');
      git(work, 'commit', '-q', '--allow-empty', '-m', 'two');

      expect(await engine().status(work)).toEqual({
        branch: 'main',
        noCommits: false,
        upstream: 'origin/main',
        ahead: 2,
        behind: 1,
        changes: []
      });
    });

    it('reports an unpublished branch without an upstream', async () => {
      cloneFixture();
      git(work, 'checkout', '-q', '-b', 'topic');

      expect(await engine().status(work)).toMatchObject({ branch: 'topic', upstream: null, ahead: 0, behind: 0 });
    });

    it('reports zero counts when the upstream is gone', async () => {
      cloneFixture();
      git(work, 'commit', '-q', '--allow-empty', '-m', 'local');
      git(work, 'update-ref', '-d', 'refs/remotes/origin/main');

      expect(await engine().status(work)).toMatchObject({
        branch: 'main',
        upstream: 'origin/main',
        ahead: 0,
        behind: 0
      });
    });

    it('reports a detached HEAD as no branch', async () => {
      cloneFixture();
      git(work, 'commit', '-q', '--allow-empty', '-m', 'local');
      git(work, 'checkout', '-q', '--detach', 'main');

      expect(await engine().status(work)).toEqual({
        branch: null,
        noCommits: false,
        upstream: null,
        ahead: 0,
        behind: 0,
        changes: []
      });
    });

    it('reports main and noCommits in a repository without commits', async () => {
      mkdirSync(work);
      git(work, 'init', '-q', '-b', 'trunk');
      writeFileSync(join(work, 'a.md'), 'new\n');

      expect(await engine().status(work)).toEqual({
        branch: 'main',
        noCommits: true,
        upstream: null,
        ahead: 0,
        behind: 0,
        changes: [ { path: 'a.md', state: 'added' } ]
      });
    });

    it('reports main and noCommits in a clone of an empty remote', async () => {
      git(root, 'clone', '-q', join(root, 'empty.git'), work);

      expect(await engine().status(work)).toMatchObject({ branch: 'main', noCommits: true, upstream: null });
    });

    it('fails outside a repository', async () => {
      mkdirSync(work);
      await expect(engine().status(join(work, 'missing'))).rejects.toThrow();
    });
  });

  describe('commit', () => {
    const AUTHOR = { name: 'Ada Lovelace', email: 'ada@example.com' };
    let work: string;

    const commit = (paths: string[], message = 'Update', author = AUTHOR) =>
      engine().commit(work, { paths, message, author });
    const changedPaths = async () => (await engine().status(work)).changes.map(change => change.path);
    const committedFiles = () => git(work, 'show', '--name-status', '--format=', 'HEAD').trim();
    const staged = () => git(work, 'diff', '--cached', '--name-only').trim();

    beforeEach(() => {
      work = join(root, 'commit');
      mkdirSync(work);
      git(work, 'init', '-q', '-b', 'main');
      writeFileSync(join(work, 'a.md'), 'a\n');
      writeFileSync(join(work, 'b.md'), 'b\n');
      writeFileSync(join(work, 'c.md'), 'c\n');
      git(work, 'add', '.');
      git(work, 'commit', '-q', '-m', 'base');
    });

    it('commits the listed files, and the others stay changed', async () => {
      for (const name of [ 'a.md', 'b.md', 'c.md' ]) {
        writeFileSync(join(work, name), 'changed\n');
      }

      const { oid } = await commit([ 'a.md', 'c.md' ]);

      expect(oid).toBe(git(work, 'rev-parse', 'HEAD').trim());
      expect(committedFiles()).toBe('M\ta.md\nM\tc.md');
      expect(await changedPaths()).toEqual([ 'b.md' ]);
      expect(staged()).toBe('');
    });

    it('AC-GIT-001.3: records the author as author and committer', async () => {
      writeFileSync(join(work, 'a.md'), 'changed\n');

      await commit([ 'a.md' ]);

      expect(git(work, 'log', '-1', '--format=%an <%ae> / %cn <%ce>').trim()).toBe(
        'Ada Lovelace <ada@example.com> / Ada Lovelace <ada@example.com>'
      );
    });

    it('AC-GIT-001.4: a config that sets user.name and user.email does not decide the author', async () => {
      git(work, 'config', 'user.name', 'Someone Else');
      git(work, 'config', 'user.email', 'else@example.com');
      git(work, 'config', 'author.name', 'Another');
      git(work, 'config', 'committer.email', 'another@example.com');
      writeFileSync(join(work, 'a.md'), 'changed\n');

      await commit([ 'a.md' ]);

      expect(git(work, 'log', '-1', '--format=%an <%ae> / %cn <%ce>').trim()).toBe(
        'Ada Lovelace <ada@example.com> / Ada Lovelace <ada@example.com>'
      );
    });

    it('keeps a line starting with #', async () => {
      writeFileSync(join(work, 'a.md'), 'changed\n');

      await commit([ 'a.md' ], 'Update the handbook\n\n# Why\nBecause.');

      expect(git(work, 'log', '-1', '--format=%B')).toBe('Update the handbook\n\n# Why\nBecause.\n\n');
    });

    it('removes trailing spaces and trailing blank lines from the message', async () => {
      writeFileSync(join(work, 'a.md'), 'changed\n');

      await commit([ 'a.md' ], 'Subject   \n\nBody line  \n\n\n');

      expect(git(work, 'log', '-1', '--format=%B')).toBe('Subject\n\nBody line\n\n');
    });

    it('commits a deletion', async () => {
      rmSync(join(work, 'b.md'));

      await commit([ 'b.md' ]);

      expect(committedFiles()).toBe('D\tb.md');
      expect(await changedPaths()).toEqual([]);
    });

    it('commits an added file', async () => {
      mkdirSync(join(work, 'docs'));
      writeFileSync(join(work, 'docs', 'new.md'), 'new\n');
      writeFileSync(join(work, 'other.md'), 'other\n');

      await commit([ 'docs/new.md' ]);

      expect(committedFiles()).toBe('A\tdocs/new.md');
      expect(await changedPaths()).toEqual([ 'other.md' ]);
    });

    it('reads names as literal paths', async () => {
      writeFileSync(join(work, ':!x'), 'magic\n');
      writeFileSync(join(work, '*.md'), 'glob\n');
      writeFileSync(join(work, 'a.md'), 'changed\n');

      await commit([ ':!x' ]);
      expect(committedFiles()).toBe('A\t:!x');

      await commit([ '*.md' ]);
      expect(committedFiles()).toBe('A\t*.md');
      expect(await changedPaths()).toEqual([ 'a.md' ]);
    });

    it('commits only the listed paths, even with something else in the index', async () => {
      writeFileSync(join(work, 'a.md'), 'changed\n');
      writeFileSync(join(work, 'b.md'), 'staged by a crash\n');
      git(work, 'add', 'b.md');

      await commit([ 'a.md' ]);

      expect(committedFiles()).toBe('M\ta.md');
      expect(await changedPaths()).toEqual([ 'b.md' ]);
      expect(staged()).toBe('');
    });

    it('empties the index when the commit fails', async () => {
      writeFileSync(join(work, 'a.md'), 'changed\n');
      const head = git(work, 'rev-parse', 'HEAD');

      await expect(commit([ 'a.md' ], 'Update', { name: '', email: 'ada@example.com' })).rejects.toThrow();

      expect(git(work, 'rev-parse', 'HEAD')).toBe(head);
      expect(staged()).toBe('');
      expect(await changedPaths()).toEqual([ 'a.md' ]);
    });

    it('refuses paths that are not changes', async () => {
      const failure = await failureOf(commit([ 'a.md', 'missing.md' ]));

      expect(failure.code).toBe('nothing-to-commit');
    });

    it('creates main on the first commit', async () => {
      const fresh = join(root, 'fresh');
      mkdirSync(fresh);
      git(fresh, 'init', '-q', '-b', 'trunk');
      writeFileSync(join(fresh, 'a.md'), 'a\n');
      writeFileSync(join(fresh, 'b.md'), 'b\n');
      work = fresh;

      await commit([ 'a.md' ]);

      expect(git(fresh, 'symbolic-ref', 'HEAD').trim()).toBe('refs/heads/main');
      expect(git(fresh, 'ls-tree', '--name-only', 'HEAD').trim()).toBe('a.md');
      expect(await changedPaths()).toEqual([ 'b.md' ]);
    });

    it('puts HEAD back when the first commit fails', async () => {
      const fresh = join(root, 'fresh');
      mkdirSync(fresh);
      git(fresh, 'init', '-q', '-b', 'trunk');
      writeFileSync(join(fresh, 'a.md'), 'a\n');
      work = fresh;

      await expect(commit([ 'a.md' ], 'Update', { name: '', email: 'ada@example.com' })).rejects.toThrow();

      expect(git(fresh, 'symbolic-ref', 'HEAD').trim()).toBe('refs/heads/trunk');
      expect(staged()).toBe('');
    });

    it('refuses a commit on a detached HEAD', async () => {
      writeFileSync(join(work, 'a.md'), 'changed\n');
      git(work, 'checkout', '-q', '--detach');

      const failure = await failureOf(commit([ 'a.md' ]));

      expect(failure.code).toBe('detached-head');
      expect(git(work, 'log', '--format=%s').trim()).toBe('base');
    });

    it('reports a timeout, and leaves no index lock and nothing staged', async () => {
      // Larger than git can add in a millisecond.
      writeFileSync(join(work, 'a.md'), 'x'.repeat(8 * 1024 * 1024));
      writeFileSync(join(work, 'b.md'), 'changed\n');
      git(work, 'add', 'b.md');

      const failure = await failureOf(
        engine({ gitTimeoutMs: 1 }).commit(work, {
          paths: [ 'a.md' ],
          message: 'Update',
          author: AUTHOR
        })
      );

      expect(failure.code).toBe('timeout');
      expect(existsSync(join(work, '.git', 'index.lock'))).toBe(false);
      expect(git(work, 'log', '--format=%s').trim()).toBe('base');
      expect(staged()).toBe('');
      expect(await changedPaths()).toEqual([ 'a.md', 'b.md' ]);
    });

    it('does not sign, even when the config asks to', async () => {
      git(work, 'config', 'commit.gpgsign', 'true');
      git(work, 'config', 'gpg.program', '/nonexistent/gpg');
      writeFileSync(join(work, 'a.md'), 'changed\n');

      await commit([ 'a.md' ]);

      expect(git(work, 'log', '-1', '--format=%G?').trim()).toBe('N');
    });

    it('does not run a hook of the repository', async () => {
      const marker = join(root, 'hook-ran');
      for (const hook of [ 'pre-commit', 'commit-msg', 'post-commit' ]) {
        writeFileSync(join(work, '.git', 'hooks', hook), `#!/bin/sh\ntouch '${marker}'\nexit 1\n`, { mode: 0o755 });
      }
      writeFileSync(join(work, 'a.md'), 'changed\n');

      await commit([ 'a.md' ]);

      expect(existsSync(marker)).toBe(false);
      expect(committedFiles()).toBe('M\ta.md');
    });
  });

  describe('diff', () => {
    let work: string;

    const diff = (path: string) => engine().diff(work, path);
    const textOf = async (path: string) => {
      const result = await diff(path);
      if (result.kind !== 'text') {
        throw new Error(`expected a text diff, got ${result.kind}`);
      }
      return result;
    };
    const numbered = (lines: number) => Array.from({ length: lines }, (_, index) => `line ${index + 1}`).join('\n');

    beforeEach(() => {
      work = join(root, 'diff');
      mkdirSync(work);
      git(work, 'init', '-q', '-b', 'main');
      writeFileSync(join(work, 'a.md'), 'one\ntwo\nthree\n');
      writeFileSync(join(work, 'gone.md'), 'first\nsecond\n');
      git(work, 'add', '.');
      git(work, 'commit', '-q', '-m', 'base');
    });

    it('shows a modified file\'s lines with both line numbers', async () => {
      writeFileSync(join(work, 'a.md'), 'one\nTWO\nthree\nfour\n');

      expect((await textOf('a.md')).lines).toEqual([
        { type: 'context', oldLine: 1, newLine: 1, text: 'one' },
        { type: 'removed', oldLine: 2, newLine: null, text: 'two' },
        { type: 'added', oldLine: null, newLine: 2, text: 'TWO' },
        { type: 'context', oldLine: 3, newLine: 3, text: 'three' },
        { type: 'added', oldLine: null, newLine: 4, text: 'four' }
      ]);
    });

    it('shows an added file\'s lines as added, and a deleted file\'s as removed', async () => {
      writeFileSync(join(work, 'new.md'), 'hello\nworld\n');
      rmSync(join(work, 'gone.md'));

      expect((await textOf('new.md')).lines).toEqual([
        { type: 'added', oldLine: null, newLine: 1, text: 'hello' },
        { type: 'added', oldLine: null, newLine: 2, text: 'world' }
      ]);
      expect((await textOf('gone.md')).lines).toEqual([
        { type: 'removed', oldLine: 1, newLine: null, text: 'first' },
        { type: 'removed', oldLine: 2, newLine: null, text: 'second' }
      ]);
    });

    it('shows every line as added before the first commit', async () => {
      const fresh = join(root, 'fresh');
      mkdirSync(fresh);
      git(fresh, 'init', '-q', '-b', 'main');
      writeFileSync(join(fresh, 'a.md'), 'a\nb\n');
      work = fresh;

      expect(await diff('a.md')).toEqual({
        kind: 'text',
        lines: [
          { type: 'added', oldLine: null, newLine: 1, text: 'a' },
          { type: 'added', oldLine: null, newLine: 2, text: 'b' }
        ],
        complete: true,
        lineEndingsOnly: false
      });
    });

    it('gives a small file the whole file as context', async () => {
      writeFileSync(join(work, 'long.md'), `${numbered(50)}\n`);
      git(work, 'add', 'long.md');
      git(work, 'commit', '-q', '-m', 'long');
      writeFileSync(join(work, 'long.md'), `${numbered(50).replace('line 25', 'LINE 25')}\n`);

      const result = await textOf('long.md');

      expect(result.complete).toBe(true);
      expect(result.lines).toHaveLength(51);
      expect(result.lines[0]).toEqual({ type: 'context', oldLine: 1, newLine: 1, text: 'line 1' });
      expect(result.lines.at(-1)).toEqual({ type: 'context', oldLine: 50, newLine: 50, text: 'line 50' });
    });

    it('keeps 3 lines of context for a file over 1 MB, not complete', async () => {
      const big = numbered(100_000);
      expect(big.length).toBeGreaterThan(1_000_000);
      writeFileSync(join(work, 'big.md'), `${big}\n`);
      git(work, 'add', 'big.md');
      git(work, 'commit', '-q', '-m', 'big');
      writeFileSync(join(work, 'big.md'), `${big.replace('line 50000\n', 'LINE 50000\n')}\n`);

      const result = await textOf('big.md');

      expect(result.complete).toBe(false);
      expect(result.lines.map(line => line.type)).toEqual([
        'context',
        'context',
        'context',
        'removed',
        'added',
        'context',
        'context',
        'context'
      ]);
      expect(result.lines[3]).toEqual({ type: 'removed', oldLine: 50000, newLine: null, text: 'line 50000' });
    });

    it('reports a changed PNG as binary, with both sizes', async () => {
      const png = Buffer.from([ 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0 ]);
      writeFileSync(join(work, 'image.png'), png);
      git(work, 'add', 'image.png');
      git(work, 'commit', '-q', '-m', 'image');
      writeFileSync(join(work, 'image.png'), Buffer.concat([ png, Buffer.from([ 0, 1, 2, 3 ]) ]));
      writeFileSync(join(work, 'new.png'), png);

      expect(await diff('image.png')).toEqual({ kind: 'binary', oldSize: 12, newSize: 16 });
      expect(await diff('new.png')).toEqual({ kind: 'binary', oldSize: null, newSize: 12 });
    });

    it('reports a diff over 1 MB as too large', async () => {
      writeFileSync(join(work, 'a.md'), `${numbered(100_000)}\n`);

      expect(await diff('a.md')).toEqual({ kind: 'too-large' });
    });

    it('says when only the line endings changed', async () => {
      writeFileSync(join(work, 'a.md'), 'one\r\ntwo\r\nthree\r\n');

      const result = await textOf('a.md');

      expect(result.lineEndingsOnly).toBe(true);
      expect(result.lines.filter(line => line.type === 'added').map(line => line.text)).toEqual([
        'one\r',
        'two\r',
        'three\r'
      ]);

      writeFileSync(join(work, 'a.md'), 'one\r\nTWO\r\nthree\r\n');
      expect((await textOf('a.md')).lineEndingsOnly).toBe(false);
    });

    it('answers no lines for an unchanged file', async () => {
      expect(await diff('a.md')).toEqual({ kind: 'text', lines: [], complete: true, lineEndingsOnly: false });
      expect(await diff('missing.md')).toEqual({ kind: 'text', lines: [], complete: true, lineEndingsOnly: false });
    });

    it('does not show git\'s no-newline marker as a line', async () => {
      writeFileSync(join(work, 'a.md'), 'one\ntwo\nthree');

      expect((await textOf('a.md')).lines).toEqual([
        { type: 'context', oldLine: 1, newLine: 1, text: 'one' },
        { type: 'context', oldLine: 2, newLine: 2, text: 'two' },
        { type: 'removed', oldLine: 3, newLine: null, text: 'three' },
        { type: 'added', oldLine: null, newLine: 3, text: 'three' }
      ]);
    });

    it('reads content lines that look like headers', async () => {
      writeFileSync(join(work, 'a.md'), '---\ntitle: x\n---\n--- a\n+++ b\n@@ -1 +1 @@\n');

      const added = (await textOf('a.md')).lines.filter(line => line.type === 'added').map(line => line.text);

      expect(added).toEqual([ '---', 'title: x', '---', '--- a', '+++ b', '@@ -1 +1 @@' ]);
    });

    it('ignores a textconv driver named by .gitattributes', async () => {
      const marker = join(root, 'textconv-ran');
      writeFileSync(join(work, '.gitattributes'), '*.md diff=upper\n');
      git(work, 'config', 'diff.upper.textconv', `sh -c 'touch "${marker}"; tr a-z A-Z < "$1"' -`);
      writeFileSync(join(work, 'a.md'), 'one\ntwo\nthree\nfour\n');

      const added = (await textOf('a.md')).lines.filter(line => line.type === 'added').map(line => line.text);

      expect(added).toEqual([ 'four' ]);
      expect(existsSync(marker)).toBe(false);
    });

    it('never writes the index', async () => {
      utimesSync(join(work, 'a.md'), new Date(2000, 0, 1), new Date(2000, 0, 1));
      const before = readFileSync(join(work, '.git', 'index'));

      await diff('a.md');

      expect(readFileSync(join(work, '.git', 'index')).equals(before)).toBe(true);
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

    it('finds whether a folder holds a submodule', async () => {
      const sha = git(work, 'rev-parse', 'HEAD').trim();
      git(work, 'update-index', '--add', '--cacheinfo', `160000,${sha},d[o]cs*/deep/mod`);

      expect(await engine().holdsSubmodule(work, 'vendor')).toBe(true);
      expect(await engine().holdsSubmodule(work, 'd[o]cs*')).toBe(true);
      expect(await engine().holdsSubmodule(work, 'docs')).toBe(false);
      expect(await engine().holdsSubmodule(work, 'vend')).toBe(false);
      expect(await engine().holdsSubmodule(work, 'build')).toBe(false);
      expect(await engine().holdsSubmodule(work, 'vendor/lib')).toBe(false);
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
