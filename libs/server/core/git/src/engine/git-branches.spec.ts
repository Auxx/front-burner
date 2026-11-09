import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitRunner } from '../runner/git-runner';
import { GitBranches } from './git-branches';
import { LocalGit } from './local-git';

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
  const branches = new GitBranches(new LocalGit(new GitRunner()));
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

  it('sorts by code units, whatever git\'s order is', async () => {
    const commit = git(work, 'rev-parse', 'HEAD');
    // UTF-8 bytes put U+FF5E before U+1F600; UTF-16 code units put the surrogate pair first.
    for (const name of [ '～', '\u{1F600}', 'Z', 'a' ]) {
      git(work, 'update-ref', `refs/heads/${name}`, commit);
    }

    expect((await branches.list(work)).local.map(branch => branch.name))
      .toEqual([ 'Z', 'a', 'main', '\u{1F600}', '～' ]);
  });
});
