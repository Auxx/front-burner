import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GitOptions } from '../git.options';
import { GitRunner } from '../runner/git-runner';
import { GitBranches } from './git-branches';
import { GitOperationError } from './git-errors';
import { GitMerge } from './git-merge';
import { LocalGit } from './local-git';

const options: GitOptions = {
  helpersDir: '/nonexistent',
  egress: { blockPrivateNetworks: true },
  cloneTimeoutMs: 60_000,
  gitTimeoutMs: 60_000,
  knownHosts: []
};

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
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf8' }).trim();

// Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
describe.skipIf(process.platform === 'win32')('GitBranches', () => {
  const branchesOn = (local: LocalGit) => new GitBranches(local, new GitMerge(local, options), options);
  const branches = branchesOn(new LocalGit(new GitRunner()));
  let work: string;

  /** A remote branch as a fetch leaves it, without needing a remote. */
  const fetched = (ref: string) => git(work, 'update-ref', `refs/remotes/${ref}`, 'HEAD');
  const track = (branch: string, upstream: string) => {
    git(work, 'config', `branch.${branch}.remote`, 'origin');
    git(work, 'config', `branch.${branch}.merge`, `refs/heads/${upstream}`);
    // Without this refspec, git does not know which remote branch `upstream` is.
    git(work, 'config', '--replace-all', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*');
  };

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'git-branches-'));
    git(work, 'init', '-q', '-b', 'main');
    git(work, 'commit', '-q', '--allow-empty', '-m', 'first');
  });

  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
  });

  it('lists local branches with their upstreams', async () => {
    git(work, 'branch', 'unpublished');
    fetched('origin/main');
    track('main', 'main');

    expect((await branches.list(work)).local).toEqual([
      { name: 'main', upstream: 'origin/main' },
      { name: 'unpublished', upstream: null }
    ]);
  });

  it('keeps the upstream of a branch whose remote branch is gone, as the status does', async () => {
    track('main', 'deleted');

    expect((await branches.list(work)).local).toEqual([ { name: 'main', upstream: 'origin/deleted' } ]);
  });

  it('marks the current branch', async () => {
    git(work, 'branch', 'other');
    expect((await branches.list(work)).current).toBe('main');

    git(work, 'switch', '-q', 'other');
    expect((await branches.list(work)).current).toBe('other');
  });

  it('lists remote branches without a local one', async () => {
    fetched('origin/zebra');
    fetched('origin/feature/deep');
    fetched('fork/other-remote');

    expect((await branches.list(work)).remote).toEqual([
      { name: 'origin/feature/deep', branch: 'feature/deep' },
      { name: 'origin/zebra', branch: 'zebra' }
    ]);
  });

  it('leaves out origin/HEAD', async () => {
    fetched('origin/draft');
    git(work, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/draft');

    expect((await branches.list(work)).remote).toEqual([ { name: 'origin/draft', branch: 'draft' } ]);
  });

  it('leaves out a remote branch of a local branch\'s name, even when it does not track it', async () => {
    fetched('origin/main');

    expect((await branches.list(work)).remote).toEqual([]);
  });

  it('leaves out a remote branch a local branch tracks', async () => {
    fetched('origin/published');
    fetched('origin/kept');
    git(work, 'branch', 'mine');
    track('mine', 'published');

    expect(await branches.list(work)).toEqual({
      current: 'main',
      local: [ { name: 'main', upstream: null }, { name: 'mine', upstream: 'origin/published' } ],
      remote: [ { name: 'origin/kept', branch: 'kept' } ]
    });
  });

  it('is not confused by a local branch named like a remote one', async () => {
    fetched('origin/main');
    git(work, 'branch', 'origin/draft');
    fetched('origin/draft');
    git(work, 'branch', '-q', '-m', 'main', 'trunk');

    expect(await branches.list(work)).toEqual({
      current: 'trunk',
      local: [ { name: 'origin/draft', upstream: null }, { name: 'trunk', upstream: null } ],
      remote: [ { name: 'origin/draft', branch: 'draft' }, { name: 'origin/main', branch: 'main' } ]
    });
  });

  describe('before the first commit', () => {
    beforeEach(() => {
      rmSync(work, { recursive: true, force: true });
      work = mkdtempSync(join(tmpdir(), 'git-branches-'));
    });

    it('lists the current branch before the first commit', async () => {
      git(work, 'init', '-q', '-b', 'main');

      expect(await branches.list(work)).toEqual({
        current: 'main',
        local: [ { name: 'main', upstream: null } ],
        remote: []
      });
    });

    it('calls it main whatever HEAD names, as the status does', async () => {
      git(work, 'init', '-q', '-b', 'trunk');

      expect(await branches.list(work)).toEqual({
        current: 'main',
        local: [ { name: 'main', upstream: null } ],
        remote: []
      });
    });

    it('leaves out the remote branch it will publish to', async () => {
      git(work, 'init', '-q', '-b', 'main');
      git(work, 'commit', '-q', '--allow-empty', '-m', 'theirs');
      const commit = git(work, 'rev-parse', 'HEAD');
      git(work, 'update-ref', 'refs/remotes/origin/main', commit);
      git(work, 'update-ref', 'refs/remotes/origin/other', commit);
      git(work, 'update-ref', '-d', 'refs/heads/main');

      expect(await branches.list(work)).toEqual({
        current: 'main',
        local: [ { name: 'main', upstream: null } ],
        remote: [ { name: 'origin/other', branch: 'other' } ]
      });
    });
  });

  it('marks nothing on a detached HEAD', async () => {
    git(work, 'checkout', '-q', '--detach', 'HEAD');

    expect(await branches.list(work)).toEqual({
      current: null,
      local: [ { name: 'main', upstream: null } ],
      remote: []
    });
  });

  it('reads every kind of branch name', async () => {
    const commit = git(work, 'rev-parse', 'HEAD');
    for (const name of [ 'feature/deep/er', 'Заметки', '-looks-like-an-option', 'with%00percent' ]) {
      git(work, 'update-ref', `refs/heads/${name}`, commit);
      git(work, 'update-ref', `refs/remotes/origin/remote-${name}`, commit);
    }

    const list = await branches.list(work);

    expect(list.local.map(branch => branch.name)).toEqual([
      '-looks-like-an-option',
      'feature/deep/er',
      'main',
      'with%00percent',
      'Заметки'
    ]);
    expect(list.remote).toEqual([
      { name: 'origin/remote--looks-like-an-option', branch: 'remote--looks-like-an-option' },
      { name: 'origin/remote-feature/deep/er', branch: 'remote-feature/deep/er' },
      { name: 'origin/remote-with%00percent', branch: 'remote-with%00percent' },
      { name: 'origin/remote-Заметки', branch: 'remote-Заметки' }
    ]);
  });

  it('leaves out a symbolic local branch, which is not a branch of its own', async () => {
    fetched('origin/alias');
    git(work, 'symbolic-ref', 'refs/heads/alias', 'refs/heads/main');

    expect(await branches.list(work)).toEqual({
      current: 'main',
      local: [ { name: 'main', upstream: null } ],
      remote: [ { name: 'origin/alias', branch: 'alias' } ]
    });
  });

  it('marks the real branch when HEAD names a symbolic one', async () => {
    git(work, 'symbolic-ref', 'refs/heads/alias', 'refs/heads/main');
    git(work, 'symbolic-ref', 'HEAD', 'refs/heads/alias');

    expect(await branches.list(work)).toEqual({
      current: 'main',
      local: [ { name: 'main', upstream: null } ],
      remote: []
    });
  });

  it('does not take a branch that is missing from the refs for a repository without commits', async () => {
    // As when a switch lands between the reads: the commit decides, not the list.
    git(work, 'branch', '-q', '-m', 'main', 'trunk');
    const local = new LocalGit(new GitRunner());
    vi.spyOn(local, 'checked').mockResolvedValue('');

    expect(await branchesOn(local).list(work)).toEqual({ current: 'trunk', local: [], remote: [] });
  });

  it('reads HEAD before the refs, so that the refs include what it named', async () => {
    const local = new LocalGit(new GitRunner());
    const run = vi.spyOn(local, 'run');

    await branchesOn(local).list(work);

    expect(run.mock.calls.map(([ , args ]) => args.find(arg => !arg.startsWith('-')))).toEqual([
      'rev-parse',
      'symbolic-ref',
      'for-each-ref'
    ]);
  });

  describe('a name that is not valid UTF-8', () => {
    const LATIN1 = Buffer.from('caf\xE9', 'latin1');
    /** Git takes any bytes; a Node argument can't carry these, so the ref is written as a file. */
    const writeRef = (folder: string, name: Buffer) => {
      const commit = git(work, 'rev-parse', 'HEAD');
      mkdirSync(join(work, '.git', folder), { recursive: true });
      writeFileSync(Buffer.concat([ Buffer.from(join(work, '.git', folder, '/')), name ]), `${commit}\n`);
    };

    it('is left out of both lists', async () => {
      writeRef('refs/heads', LATIN1);
      writeRef('refs/remotes/origin', LATIN1);

      expect(await branches.list(work)).toEqual({
        current: 'main',
        local: [ { name: 'main', upstream: null } ],
        remote: []
      });
    });

    it('is no current branch', async () => {
      writeRef('refs/heads', LATIN1);
      writeFileSync(
        join(work, '.git', 'HEAD'),
        Buffer.concat([ Buffer.from('ref: refs/heads/'), LATIN1, Buffer.from('\n') ])
      );

      expect(await branches.list(work)).toEqual({
        current: null,
        local: [ { name: 'main', upstream: null } ],
        remote: []
      });
    });

    it('still keeps what it tracks out of the remote list', async () => {
      fetched('origin/published');
      writeRef('refs/heads', LATIN1);
      writeFileSync(
        join(work, '.git', 'config'),
        Buffer.concat([
          Buffer.from('[remote "origin"]\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n[branch "'),
          LATIN1,
          Buffer.from('"]\n\tremote = origin\n\tmerge = refs/heads/published\n')
        ]),
        { flag: 'a' }
      );

      expect((await branches.list(work)).remote).toEqual([]);
    });
  });

  it('sorts by code units, whatever git\'s order is', async () => {
    const commit = git(work, 'rev-parse', 'HEAD');
    // UTF-8 bytes put U+FF5E before U+1F600; UTF-16 code units put the surrogate pair first.
    for (const name of [ '～', '\u{1F600}', 'Z', 'a' ]) {
      git(work, 'update-ref', `refs/heads/${name}`, commit);
    }

    expect((await branches.list(work)).local.map(branch => branch.name))
      .toEqual([ 'Z', 'a', 'main', '\u{1F600}', '～' ]);
  });

  describe('switching and creating', () => {
    const current = () => git(work, 'symbolic-ref', '--short', 'HEAD');
    const head = (rev = 'HEAD') => git(work, 'rev-parse', rev);
    const hasBranch = (name: string) => git(work, 'branch', '--list', name) !== '';
    const codeOf = (attempt: Promise<void>) =>
      attempt.then(
        () => 'no error',
        (error: unknown) => (error instanceof GitOperationError ? error.code : error)
      );
    const fetchesEveryBranch = () =>
      git(work, 'config', '--replace-all', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*');
    const write = (path: string, text: string) => writeFileSync(join(work, path), text);
    const read = (path: string) => readFileSync(join(work, path), 'utf8');
    /** A branch with `path` committed, and back on `main`. */
    const branchWith = (name: string, path: string, text: string) => {
      git(work, 'switch', '-q', '-c', name);
      write(path, text);
      git(work, 'add', '-f', path);
      git(work, 'commit', '-q', '-m', `${path} on ${name}`);
      git(work, 'switch', '-q', 'main');
    };

    beforeEach(() => {
      write('notes.md', 'on main\n');
      git(work, 'add', '.');
      git(work, 'commit', '-q', '-m', 'notes');
    });

    describe('to a local branch', () => {
      it('switches to a local branch', async () => {
        git(work, 'branch', 'other');

        await branches.switchTo(work, 'other');

        expect(current()).toBe('other');
      });

      it('changes the files with the branch', async () => {
        branchWith('other', 'notes.md', 'on other\n');

        await branches.switchTo(work, 'other');

        expect(read('notes.md')).toBe('on other\n');
      });

      it('says when the branch is gone', async () => {
        expect(await codeOf(branches.switchTo(work, 'gone'))).toBe('branch-not-found');
      });

      it('takes only a local branch, never what else git reads from a name', async () => {
        git(work, 'branch', 'other');
        git(work, 'switch', '-q', 'other');
        git(work, 'switch', '-q', 'main');
        git(work, 'tag', 'v1');
        fetched('origin/published');

        // The first two would be the previous branch, `other`.
        for (const name of [ '-', '@{-1}', 'HEAD', 'v1', 'origin/published', 'refs/heads/other', 'a\0b', '' ]) {
          expect(await codeOf(branches.switchTo(work, name)), name).toBe('branch-not-found');
          expect(current()).toBe('main');
        }
      });

      it('does not overwrite an ignored file', async () => {
        branchWith('other', 'secret.txt', 'from other\n');
        write('.git/info/exclude', 'secret.txt\n');
        write('secret.txt', 'mine\n');

        expect(await codeOf(branches.switchTo(work, 'other'))).toBe('switch-blocked');

        expect(read('secret.txt')).toBe('mine\n');
        expect(current()).toBe('main');
      });

      it('does not lose an ignored file in a folder that the branch has a file in place of', async () => {
        branchWith('other', 'build', 'a file on other\n');
        write('.git/info/exclude', 'build/\n');
        mkdirSync(join(work, 'build'));
        write('build/output.txt', 'mine\n');

        expect(await codeOf(branches.switchTo(work, 'other'))).toBe('switch-blocked');

        expect(read('build/output.txt')).toBe('mine\n');
        expect(current()).toBe('main');
      });

      it('does not run LFS, which would reach the network', async () => {
        git(work, 'switch', '-q', '-c', 'other');
        write('.gitattributes', 'large.bin filter=lfs\n');
        write('large.bin', 'pointer\n');
        git(work, 'add', '.');
        git(work, 'commit', '-q', '-m', 'large');
        git(work, 'switch', '-q', 'main');
        git(work, 'config', 'filter.lfs.smudge', 'false');
        git(work, 'config', 'filter.lfs.required', 'true');

        await branches.switchTo(work, 'other');

        expect(read('large.bin')).toBe('pointer\n');
      });

      it('frees the locks of a switch that ran out of time, and says so', async () => {
        git(work, 'branch', 'other');
        const local = new LocalGit(new GitRunner());
        const run = local.run.bind(local);
        vi.spyOn(local, 'run').mockImplementation(async (cwd, args, options) => {
          if (!args.includes('switch')) {
            return run(cwd, args, options);
          }
          write('.git/index.lock', '');
          write('.git/HEAD.lock', '');
          return { exitCode: null, stdout: '', stdoutBytes: 0, stderr: '', timedOut: true };
        });

        expect(await codeOf(branchesOn(local).switchTo(work, 'other'))).toBe('timeout');

        expect(existsSync(join(work, '.git', 'index.lock'))).toBe(false);
        expect(existsSync(join(work, '.git', 'HEAD.lock'))).toBe(false);
      });

      it('puts the files back after a switch that ran out of time', async () => {
        git(work, 'branch', 'other');
        const local = new LocalGit(new GitRunner());
        const run = local.run.bind(local);
        vi.spyOn(local, 'run').mockImplementation(async (cwd, args, runOptions) => {
          if (!args.includes('switch')) {
            return run(cwd, args, runOptions);
          }
          write('notes.md', 'half of the other branch\n');
          write('only-on-other.md', 'written before it was killed\n');
          write('.git/index.lock', '');
          return { exitCode: null, stdout: '', stdoutBytes: 0, stderr: '', timedOut: true };
        });

        expect(await codeOf(branchesOn(local).switchTo(work, 'other'))).toBe('timeout');

        expect(read('notes.md')).toBe('on main\n');
        expect(git(work, 'status', '--porcelain')).toBe('');
        expect(current()).toBe('main');
      });

      it('gives a failure it does not know as an error of its own', async () => {
        git(work, 'branch', 'other');
        const local = new LocalGit(new GitRunner());
        const run = local.run.bind(local);
        vi.spyOn(local, 'run').mockImplementation(async (cwd, args, runOptions) => {
          if (!args.includes('switch')) {
            return run(cwd, args, runOptions);
          }
          return { exitCode: 128, stdout: '', stdoutBytes: 0, stderr: 'fatal: something new\n', timedOut: false };
        });

        expect(await codeOf(branchesOn(local).switchTo(work, 'other'))).toBeInstanceOf(Error);
      });

      it('says that git is busy when another git holds the index', async () => {
        git(work, 'branch', 'other');
        write('.git/index.lock', '');

        expect(await codeOf(branches.switchTo(work, 'other'))).toBe('git-busy');

        expect(current()).toBe('main');
      });

      it('says that a branch git will not switch to by its name is gone', async () => {
        git(work, 'update-ref', 'refs/heads/@', 'HEAD');

        expect(await codeOf(branches.switchTo(work, '@'))).toBe('branch-not-found');
      });

      it('refuses a name too long to be a file', async () => {
        expect(await codeOf(branches.switchTo(work, 'x'.repeat(300)))).toBe('branch-not-found');
      });

      it('switches to the main that the list gives before the first commit, as there already', async () => {
        const empty = mkdtempSync(join(tmpdir(), 'git-branches-'));
        try {
          git(empty, 'init', '-q', '-b', 'main');

          await branches.switchTo(empty, 'main');

          expect(git(empty, 'symbolic-ref', '--short', 'HEAD')).toBe('main');
          expect(await codeOf(branches.switchTo(empty, 'other'))).toBe('branch-not-found');
        } finally {
          rmSync(empty, { recursive: true, force: true });
        }
      });
    });

    describe('to a remote branch', () => {
      beforeEach(fetchesEveryBranch);

      it('makes a local branch that tracks a remote one, and switches to it', async () => {
        branchWith('published', 'notes.md', 'published\n');
        git(work, 'update-ref', 'refs/remotes/origin/feature', 'published');
        git(work, 'branch', '-q', '-D', 'published');

        await branches.trackRemote(work, 'feature');

        expect(current()).toBe('feature');
        expect(read('notes.md')).toBe('published\n');
        expect((await branches.list(work)).local).toContainEqual({ name: 'feature', upstream: 'origin/feature' });
      });

      it('leaves the config\'s lock when it ran out of time, as a push may hold it', async () => {
        fetched('origin/feature');
        write('.git/config.lock', '');
        const local = new LocalGit(new GitRunner());
        const run = local.run.bind(local);
        vi.spyOn(local, 'run').mockImplementation(async (cwd, args, runOptions) => {
          if (!args.includes('--track')) {
            return run(cwd, args, runOptions);
          }
          write('.git/refs/heads/feature.lock', '');
          return { exitCode: null, stdout: '', stdoutBytes: 0, stderr: '', timedOut: true };
        });

        expect(await codeOf(branchesOn(local).trackRemote(work, 'feature'))).toBe('timeout');

        expect(existsSync(join(work, '.git', 'config.lock'))).toBe(true);
        expect(existsSync(join(work, '.git', 'refs', 'heads', 'feature.lock'))).toBe(false);
      });

      it('says that git is busy when a push holds the config, and leaves no branch and no change', async () => {
        branchWith('published', 'notes.md', 'published\n');
        git(work, 'update-ref', 'refs/remotes/origin/feature', 'published');
        write('.git/config.lock', '');

        expect(await codeOf(branches.trackRemote(work, 'feature'))).toBe('git-busy');

        expect(hasBranch('feature')).toBe(false);
        expect(git(work, 'status', '--porcelain')).toBe('');
        expect(current()).toBe('main');
      });

      it('leaves no upstream behind when the switch is blocked', async () => {
        branchWith('published', 'secret.txt', 'from the remote\n');
        git(work, 'update-ref', 'refs/remotes/origin/feature', 'published');
        write('.git/info/exclude', 'secret.txt\n');
        write('secret.txt', 'mine\n');

        await codeOf(branches.trackRemote(work, 'feature'));

        expect(() => git(work, 'config', '--get', 'branch.feature.remote')).toThrow();
      });

      it('puts the files back and leaves no branch after a switch that ran out of time', async () => {
        fetched('origin/feature');
        const local = new LocalGit(new GitRunner());
        const run = local.run.bind(local);
        vi.spyOn(local, 'run').mockImplementation(async (cwd, args, runOptions) => {
          if (!args.includes('switch')) {
            return run(cwd, args, runOptions);
          }
          write('notes.md', 'half of the other branch\n');
          return { exitCode: null, stdout: '', stdoutBytes: 0, stderr: '', timedOut: true };
        });

        expect(await codeOf(branchesOn(local).trackRemote(work, 'feature'))).toBe('timeout');

        expect(read('notes.md')).toBe('on main\n');
        expect(hasBranch('feature')).toBe(false);
      });

      it('tracks a remote branch before the first commit', async () => {
        const commit = head();
        const empty = mkdtempSync(join(tmpdir(), 'git-branches-'));
        try {
          git(empty, 'init', '-q', '-b', 'main');
          git(empty, 'config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*');
          git(empty, 'fetch', '-q', work, `+${commit}:refs/remotes/origin/feature`);

          await branches.trackRemote(empty, 'feature');

          expect(git(empty, 'symbolic-ref', '--short', 'HEAD')).toBe('feature');
        } finally {
          rmSync(empty, { recursive: true, force: true });
        }
      });

      it('says when the remote branch is gone', async () => {
        expect(await codeOf(branches.trackRemote(work, 'gone'))).toBe('branch-not-found');
        expect(hasBranch('gone')).toBe(false);
      });

      it('says that a remote branch the working copy does not fetch is gone', async () => {
        branchWith('published', 'notes.md', 'published\n');
        git(work, 'update-ref', 'refs/remotes/origin/feature', 'published');
        git(work, 'config', '--replace-all', 'remote.origin.fetch', '+refs/heads/main:refs/remotes/origin/main');

        expect(await codeOf(branches.trackRemote(work, 'feature'))).toBe('branch-not-found');
        expect(hasBranch('feature')).toBe(false);
        // Git changes the files first when it is asked to do both at once.
        expect(git(work, 'status', '--porcelain')).toBe('');
      });

      it('tracks the remote branch when a local branch has its name', async () => {
        fetched('origin/feature');
        const remoteCommit = head();
        git(work, 'commit', '-q', '--allow-empty', '-m', 'only local');
        // A shorter spelling would mean this branch, not the remote one.
        git(work, 'branch', 'origin/feature');
        git(work, 'reset', '-q', '--hard', remoteCommit);

        await branches.trackRemote(work, 'feature');

        expect(current()).toBe('feature');
        expect(head()).toBe(remoteCommit);
        expect((await branches.list(work)).local).toContainEqual({ name: 'feature', upstream: 'origin/feature' });
      });

      it('refuses a local branch of that name', async () => {
        fetched('origin/main');
        git(work, 'commit', '-q', '--allow-empty', '-m', 'later');
        const before = head();

        expect(await codeOf(branches.trackRemote(work, 'main'))).toBe('branch-exists');

        expect(head('main')).toBe(before);
        expect((await branches.list(work)).local).toEqual([ { name: 'main', upstream: null } ]);
      });

      it('does not overwrite an ignored file, and leaves no branch behind', async () => {
        branchWith('published', 'secret.txt', 'from the remote\n');
        git(work, 'update-ref', 'refs/remotes/origin/feature', 'published');
        write('.git/info/exclude', 'secret.txt\n');
        write('secret.txt', 'mine\n');

        expect(await codeOf(branches.trackRemote(work, 'feature'))).toBe('switch-blocked');

        expect(read('secret.txt')).toBe('mine\n');
        expect(current()).toBe('main');
        expect(hasBranch('feature')).toBe(false);
      });

      it('refuses a name that clashes with a folder of branches', async () => {
        git(work, 'branch', 'a');
        branchWith('published', 'notes.md', 'published\n');
        git(work, 'update-ref', 'refs/remotes/origin/a/b', 'published');

        expect(await codeOf(branches.trackRemote(work, 'a/b'))).toBe('branch-name-conflict');

        // Git changes the files first when it is asked to do both at once.
        expect(git(work, 'status', '--porcelain')).toBe('');
        expect(read('notes.md')).toBe('on main\n');
        expect(current()).toBe('main');
      });
    });

    describe('a new branch', () => {
      it('creates a branch from the current commit, unpublished, and switches to it', async () => {
        fetchesEveryBranch();
        fetched('origin/topic');
        git(work, 'commit', '-q', '--allow-empty', '-m', 'later');
        const commit = head();

        await branches.create(work, 'topic');

        expect(current()).toBe('topic');
        expect(head()).toBe(commit);
        expect((await branches.list(work)).local).toContainEqual({ name: 'topic', upstream: null });
      });

      it('keeps uncommitted changes on a new branch', async () => {
        write('notes.md', 'unsaved work\n');
        write('new.md', 'new\n');

        await branches.create(work, 'topic');

        expect(current()).toBe('topic');
        expect(read('notes.md')).toBe('unsaved work\n');
        expect(read('new.md')).toBe('new\n');
      });

      it('refuses every kind of bad name', async () => {
        for (const name of [ 'bad..name', '@{-1}', 'HEAD', '-x', '-', '', 'with space', 'a\0b' ]) {
          expect(await codeOf(branches.create(work, name)), name).toBe('branch-name-invalid');
          expect(await codeOf(branches.trackRemote(work, name)), name).toBe('branch-name-invalid');
        }
        expect(current()).toBe('main');
      });

      it('refuses @, which git can\'t switch to by its name', async () => {
        expect(await codeOf(branches.create(work, '@'))).toBe('branch-name-invalid');
        expect(await codeOf(branches.trackRemote(work, '@'))).toBe('branch-name-invalid');
        expect(current()).toBe('main');
      });

      it('refuses the names of git\'s own refs, which git would read as a merge or a pull', async () => {
        for (const name of [ 'MERGE_HEAD', 'ORIG_HEAD', 'FETCH_HEAD', 'CHERRY_PICK_HEAD', 'AUTO_MERGE' ]) {
          expect(await codeOf(branches.create(work, name)), name).toBe('branch-name-invalid');
          expect(await codeOf(branches.trackRemote(work, name)), name).toBe('branch-name-invalid');
        }
        expect(current()).toBe('main');
      });

      it('keeps a name that only looks like one of them', async () => {
        await branches.create(work, 'feature/MERGE_HEAD');
        await branches.create(work, 'Head');

        expect(current()).toBe('Head');
      });

      it('refuses a name too long for a ref\'s file', async () => {
        for (const name of [ 'x'.repeat(300), `a/${'x'.repeat(251)}`, `${'é'.repeat(126)}`, 'a/'.repeat(600) + 'a' ]) {
          expect(await codeOf(branches.create(work, name)), name.slice(0, 8)).toBe('branch-name-invalid');
        }
        expect(current()).toBe('main');
      });

      it('takes the longest name that fits', async () => {
        await branches.create(work, 'x'.repeat(250));

        expect(current()).toBe('x'.repeat(250));
      });

      it('says when there are no commits to start from, reading no files', async () => {
        const empty = mkdtempSync(join(tmpdir(), 'git-branches-'));
        try {
          git(empty, 'init', '-q', '-b', 'main');

          expect(await codeOf(branches.create(empty, 'topic'))).toBe('no-commits');
          expect(git(empty, 'symbolic-ref', '--short', 'HEAD')).toBe('main');
        } finally {
          rmSync(empty, { recursive: true, force: true });
        }
      });

      it('leaves uncommitted changes alone after running out of time', async () => {
        write('notes.md', 'unsaved work\n');
        const local = new LocalGit(new GitRunner());
        const run = local.run.bind(local);
        vi.spyOn(local, 'run').mockImplementation(async (cwd, args, runOptions) => {
          if (!args.includes('switch')) {
            return run(cwd, args, runOptions);
          }
          return { exitCode: null, stdout: '', stdoutBytes: 0, stderr: '', timedOut: true };
        });

        expect(await codeOf(branchesOn(local).create(work, 'topic'))).toBe('timeout');

        expect(read('notes.md')).toBe('unsaved work\n');
      });

      it('says that git is busy when another git holds the branch\'s lock', async () => {
        write('.git/refs/heads/topic.lock', '');

        expect(await codeOf(branches.create(work, 'topic'))).toBe('git-busy');

        expect(current()).toBe('main');
      });

      it('refuses a name in use', async () => {
        git(work, 'branch', 'taken');

        expect(await codeOf(branches.create(work, 'taken'))).toBe('branch-exists');

        expect(current()).toBe('main');
      });

      it('refuses a name that clashes with a folder of branches', async () => {
        git(work, 'branch', 'a');
        git(work, 'branch', 'b/c');

        expect(await codeOf(branches.create(work, 'a/b'))).toBe('branch-name-conflict');
        expect(await codeOf(branches.create(work, 'b'))).toBe('branch-name-conflict');

        expect(current()).toBe('main');
      });

      it('frees the new branch\'s lock when it ran out of time', async () => {
        const local = new LocalGit(new GitRunner());
        const run = local.run.bind(local);
        vi.spyOn(local, 'run').mockImplementation(async (cwd, args, runOptions) => {
          if (!args.includes('switch')) {
            return run(cwd, args, runOptions);
          }
          mkdirSync(join(work, '.git', 'refs', 'heads', 'dir'));
          write('.git/refs/heads/dir/topic.lock', '');
          return { exitCode: null, stdout: '', stdoutBytes: 0, stderr: '', timedOut: true };
        });

        expect(await codeOf(branchesOn(local).create(work, 'dir/topic'))).toBe('timeout');

        expect(existsSync(join(work, '.git', 'refs', 'heads', 'dir', 'topic.lock'))).toBe(false);
      });
    });

    it('treats a name like an option as a name', async () => {
      git(work, 'branch', 'other');

      for (const name of [ '--orphan=boom', '--detach', '-c' ]) {
        expect(await codeOf(branches.switchTo(work, name)), name).toBe('branch-not-found');
        expect(await codeOf(branches.trackRemote(work, name)), name).toBe('branch-name-invalid');
        expect(await codeOf(branches.create(work, name)), name).toBe('branch-name-invalid');
        expect(current()).toBe('main');
        expect(read('notes.md')).toBe('on main\n');
      }
    });
  });
});
