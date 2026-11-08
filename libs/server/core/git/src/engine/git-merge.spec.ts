import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitRunner } from '../runner/git-runner';
import { GitMerge } from './git-merge';
import { LocalGit } from './local-git';

const REF = 'refs/front-burner/pre-merge';

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

describe('GitMerge', () => {
  const merge = new GitMerge(new LocalGit(new GitRunner()));
  let root: string;
  let work: string;

  const write = (name: string, content: string) => writeFileSync(join(work, name), content);
  const commitAll = (message: string) => {
    git(work, 'add', '-A');
    git(work, 'commit', '-q', '-m', message);
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'git-merge-'));
    work = join(root, 'work');
    mkdirSync(work);
    git(work, 'init', '-q', '-b', 'main');
    write('.gitignore', 'ignored.log\n');
    write('first.md', 'one\n');
    commitAll('first');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('records the current commit under a ref', async () => {
    const oid = await merge.record(work);

    expect(oid).toBe(git(work, 'rev-parse', 'HEAD'));
    expect(git(work, 'rev-parse', REF)).toBe(oid);
  });

  it('keeps the commit from garbage collection', async () => {
    const oid = await merge.record(work);
    write('first.md', 'two\n');
    commitAll('second');
    git(work, 'reset', '-q', '--hard', 'HEAD~1');
    git(work, 'checkout', '-q', '--detach', 'HEAD');
    git(work, 'branch', '-q', '-D', 'main');
    git(work, 'reflog', 'expire', '--expire=now', '--all');
    git(work, 'gc', '-q', '--prune=now');

    expect(git(work, 'cat-file', '-t', oid)).toBe('commit');
  });

  it('forgets the ref', async () => {
    await merge.record(work);

    await merge.forgetRecord(work);

    expect(() => git(work, 'rev-parse', '--verify', '-q', REF)).toThrow();
  });

  it('keeps an earlier record again', async () => {
    const earlier = await merge.record(work);
    write('first.md', 'two\n');
    commitAll('second');
    await merge.record(work);

    await merge.keepRecord(work, earlier);

    expect(git(work, 'rev-parse', REF)).toBe(earlier);
  });

  /** `main` and `theirs` with a clean merged file, a Both added file and a Deleted by them file. */
  function conflictingMerge(): string {
    write('clean.md', 'a\nb\nc\n');
    write('gone.md', 'x\n');
    commitAll('base');
    git(work, 'checkout', '-q', '-b', 'theirs');
    write('clean.md', 'a\nb\nC\n');
    write('both.md', 'theirs\n');
    git(work, 'rm', '-q', 'gone.md');
    commitAll('theirs');
    git(work, 'checkout', '-q', 'main');
    write('clean.md', 'A\nb\nc\n');
    write('both.md', 'mine\n');
    write('gone.md', 'x changed\n');
    commitAll('mine');
    const oid = git(work, 'rev-parse', 'HEAD');
    expect(() => git(work, 'merge', '--no-edit', 'theirs')).toThrow();
    return oid;
  }

  it('resetTo ends a merge and puts every file back', async () => {
    const oid = conflictingMerge();
    expect(git(work, 'status', '--porcelain')).toBe(
      'AA both.md\nM  clean.md\nUD gone.md'
    );

    await merge.resetTo(work, oid);

    expect(git(work, 'status', '--porcelain')).toBe('');
    expect(existsSync(join(work, '.git', 'MERGE_HEAD'))).toBe(false);
    expect(readFileSync(join(work, 'clean.md'), 'utf8')).toBe('A\nb\nc\n');
    expect(readFileSync(join(work, 'both.md'), 'utf8')).toBe('mine\n');
    expect(readFileSync(join(work, 'gone.md'), 'utf8')).toBe('x changed\n');
  });

  it('undoCutShort works with a stale lock, removes untracked files and keeps ignored ones', async () => {
    const oid = conflictingMerge();
    writeFileSync(join(work, '.git', 'index.lock'), '');
    write('partial.md', 'left by a killed checkout\n');
    mkdirSync(join(work, 'newdir'));
    write('newdir/inner.md', 'inner\n');
    write('ignored.log', 'keep me\n');

    await merge.undoCutShort(work, oid);

    expect(existsSync(join(work, '.git', 'index.lock'))).toBe(false);
    expect(existsSync(join(work, '.git', 'MERGE_HEAD'))).toBe(false);
    expect(existsSync(join(work, 'partial.md'))).toBe(false);
    expect(existsSync(join(work, 'newdir'))).toBe(false);
    expect(readFileSync(join(work, 'ignored.log'), 'utf8')).toBe('keep me\n');
    expect(git(work, 'status', '--porcelain')).toBe('');
  });
});
