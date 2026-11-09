import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { GitOptions } from '../git.options';
import { GitRunner } from '../runner/git-runner';
import { GitOperationError } from './git-errors';
import { GitMerge } from './git-merge';
import { LocalGit, LocalRunOptions } from './local-git';

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

// Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
describe.skipIf(process.platform === 'win32')('GitMerge', () => {
  const merge = new GitMerge(new LocalGit(new GitRunner()), { gitTimeoutMs: 60_000 } as GitOptions);
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

  it('says which commit HEAD is and which the ref keeps', async () => {
    expect(await merge.recordedCommit(work)).toBeNull();

    const oid = await merge.record(work);

    expect(await merge.head(work)).toBe(git(work, 'rev-parse', 'HEAD'));
    expect(await merge.recordedCommit(work)).toBe(oid);
  });

  it('abort ends a merge with git\'s own abort, and keeps a change that was there before it', async () => {
    write('other.md', 'mine alone\n');
    commitAll('other');
    const head = conflictingMerge();
    git(work, 'merge', '--abort');
    write('other.md', 'not committed\n');
    expect(() => git(work, 'merge', '--no-edit', 'theirs')).toThrow();

    await merge.abort(work);

    expect(existsSync(join(work, '.git', 'MERGE_HEAD'))).toBe(false);
    expect(git(work, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(work, 'status', '--porcelain')).toBe('M other.md');
    expect(readFileSync(join(work, 'other.md'), 'utf8')).toBe('not committed\n');
  });

  it('abort fails when there is no merge, and changes nothing', async () => {
    write('first.md', 'not committed\n');

    await expect(merge.abort(work)).rejects.toThrow('merge --abort');

    expect(readFileSync(join(work, 'first.md'), 'utf8')).toBe('not committed\n');
  });

  it('abort still ends a merge that git refuses to abort, as with a resolved file edited again', async () => {
    const head = conflictingMerge();
    write('both.md', 'resolved\n');
    git(work, 'add', 'both.md');
    write('both.md', 'edited again\n');

    await merge.abort(work);

    expect(existsSync(join(work, '.git', 'MERGE_HEAD'))).toBe(false);
    expect(git(work, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(work, 'status', '--porcelain')).toBe('');
    expect(readFileSync(join(work, 'both.md'), 'utf8')).toBe('mine\n');
  });

  describe('when git is killed at its timeout', () => {
    /** Leaves what a killed git leaves, once, instead of running the command that has `killed` among its arguments. */
    class KilledLocalGit extends LocalGit {
      private done = false;

      constructor(private readonly killed: string) {
        super(new GitRunner());
      }

      override async run(cwd: string, args: string[], options?: LocalRunOptions) {
        if (this.done || !args.includes(this.killed)) {
          return super.run(cwd, args, options);
        }
        this.done = true;
        writeFileSync(join(work, '.git', 'index.lock'), '');
        return { ...await super.run(cwd, [ 'version' ]), exitCode: null, timedOut: true };
      }
    }

    it.each([
      [ 'resetTo', 'reset', (killed: GitMerge, oid: string) => killed.resetTo(work, oid) ],
      [ 'abort', 'merge', (killed: GitMerge) => killed.abort(work) ]
    ])('%s can be tried again', async (_name, command, act) => {
      const oid = conflictingMerge();
      const killed = new GitMerge(new KilledLocalGit(command), { gitTimeoutMs: 60_000 } as GitOptions);

      await expect(act(killed, oid)).rejects.toMatchObject({ code: 'timeout' });

      // Not ended some other way: a timeout says nothing about what git would refuse.
      expect(existsSync(join(work, '.git', 'MERGE_HEAD'))).toBe(true);
      expect(existsSync(join(work, '.git', 'index.lock'))).toBe(false);
      await act(killed, oid);
      expect(existsSync(join(work, '.git', 'MERGE_HEAD'))).toBe(false);
      expect(git(work, 'status', '--porcelain')).toBe('');
    });
  });

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

  it('removeStaleLocks removes locks in .git and under refs, and nothing else', async () => {
    const gitDir = join(work, '.git');
    mkdirSync(join(gitDir, 'refs', 'remotes', 'origin'), { recursive: true });
    for (
      const lock of [
        'index.lock',
        'HEAD.lock',
        'ORIG_HEAD.lock',
        'refs/heads/main.lock',
        'refs/remotes/origin/a.lock'
      ]
    ) {
      writeFileSync(join(gitDir, lock), '');
    }
    write('notes.lock', 'the user\'s file\n');
    const object = join(gitDir, 'objects', 'kept.lock');
    writeFileSync(object, '');

    await merge.removeStaleLocks(work);

    for (
      const lock of [
        'index.lock',
        'HEAD.lock',
        'ORIG_HEAD.lock',
        'refs/heads/main.lock',
        'refs/remotes/origin/a.lock'
      ]
    ) {
      expect(existsSync(join(gitDir, lock)), lock).toBe(false);
    }
    expect(existsSync(join(work, 'notes.lock'))).toBe(true);
    expect(existsSync(object)).toBe(true);
    expect(existsSync(join(gitDir, 'HEAD'))).toBe(true);
    expect(git(work, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
  });

  it('removeStaleLocks removes what a killed rewrite of packed-refs leaves', async () => {
    git(work, 'branch', 'gone');
    git(work, 'pack-refs', '--all');
    writeFileSync(join(work, '.git', 'packed-refs.lock'), '');
    writeFileSync(join(work, '.git', 'packed-refs.new'), '');

    await merge.removeStaleLocks(work);

    git(work, 'update-ref', '-d', 'refs/heads/gone');
    expect(existsSync(join(work, '.git', 'packed-refs'))).toBe(true);
  });

  it('isCutShort knows the recorded commit and a merge made on it, and nothing else', async () => {
    const recorded = git(work, 'rev-parse', 'HEAD');
    expect(await merge.isCutShort(work, recorded)).toBe(true);

    git(work, 'checkout', '-q', '-b', 'theirs');
    write('theirs.md', 'theirs\n');
    commitAll('theirs');
    git(work, 'checkout', '-q', 'main');
    write('mine.md', 'mine\n');
    commitAll('mine');
    const beforeMerge = git(work, 'rev-parse', 'HEAD');
    expect(await merge.isCutShort(work, recorded)).toBe(false);

    git(work, 'merge', '-q', '--no-edit', 'theirs');
    expect(await merge.isCutShort(work, beforeMerge)).toBe(true);
    expect(await merge.isCutShort(work, recorded)).toBe(false);
  });

  it('undoCutShort works with the locks of the merge\'s own refs', async () => {
    const oid = conflictingMerge();
    for (const lock of [ 'HEAD.lock', 'ORIG_HEAD.lock', 'refs/heads/main.lock' ]) {
      writeFileSync(join(work, '.git', lock), '');
    }
    // A fetch may hold this one meanwhile.
    mkdirSync(join(work, '.git', 'refs', 'remotes', 'origin'), { recursive: true });
    writeFileSync(join(work, '.git', 'refs', 'remotes', 'origin', 'main.lock'), '');

    await merge.undoCutShort(work, oid);

    expect(git(work, 'status', '--porcelain')).toBe('');
    expect(existsSync(join(work, '.git', 'MERGE_HEAD'))).toBe(false);
    expect(existsSync(join(work, '.git', 'refs', 'remotes', 'origin', 'main.lock'))).toBe(true);
  });

  it('undoCutShort keeps the user\'s empty folders and folders with only ignored files', async () => {
    const oid = conflictingMerge();
    mkdirSync(join(work, 'empty', 'inner'), { recursive: true });
    mkdirSync(join(work, 'logs'));
    write('logs/ignored.log', 'keep me\n');
    mkdirSync(join(work, 'newdir'));
    write('newdir/partial.md', 'left by a killed checkout\n');
    write('newdir/ignored.log', 'keep me too\n');

    await merge.undoCutShort(work, oid);

    expect(existsSync(join(work, 'empty', 'inner'))).toBe(true);
    expect(readFileSync(join(work, 'logs', 'ignored.log'), 'utf8')).toBe('keep me\n');
    expect(existsSync(join(work, 'newdir', 'partial.md'))).toBe(false);
    expect(readFileSync(join(work, 'newdir', 'ignored.log'), 'utf8')).toBe('keep me too\n');
  });

  describe('reading a merge', () => {
    const sizeOf = (content: string) => Buffer.byteLength(content);

    it('lists unresolved files with their kinds and sizes', async () => {
      write('edited.md', 'a\n');
      commitAll('edited');
      git(work, 'switch', '-q', '-c', 'theirs');
      write('edited.md', 'theirs!\n');
      commitAll('theirs');
      git(work, 'switch', '-q', 'main');
      write('edited.md', 'mine\n');
      commitAll('mine');
      expect(() => git(work, 'merge', '--no-edit', 'theirs')).toThrow();

      expect(await merge.conflicts(work)).toEqual([
        {
          path: 'edited.md',
          kind: 'both-changed',
          resolved: false,
          baseOid: git(work, 'rev-parse', ':1:edited.md'),
          oursOid: git(work, 'rev-parse', ':2:edited.md'),
          theirsOid: git(work, 'rev-parse', ':3:edited.md'),
          oursMode: '100644',
          theirsMode: '100644',
          oursSize: sizeOf('mine\n'),
          theirsSize: sizeOf('theirs!\n')
        }
      ]);
    });

    it('lists resolved files too', async () => {
      conflictingMerge();
      git(work, 'add', 'both.md');

      const conflicts = await merge.conflicts(work);

      expect(conflicts.map(({ path, resolved }) => [ path, resolved ])).toEqual([
        [ 'both.md', true ],
        [ 'gone.md', false ]
      ]);
    });

    it('keeps the kind of a resolved file', async () => {
      conflictingMerge();
      git(work, 'add', 'both.md');
      git(work, 'rm', '-q', 'gone.md');

      const conflicts = await merge.conflicts(work);

      expect(conflicts).toMatchObject([
        { path: 'both.md', kind: 'both-added', resolved: true, oursSize: sizeOf('mine\n') },
        { path: 'gone.md', kind: 'deleted-by-them', resolved: true, theirsOid: null, theirsSize: null }
      ]);
    });

    it('gives a kind to a file with one stage', async () => {
      write('renamed.md', 'text\n');
      commitAll('base');
      git(work, 'switch', '-q', '-c', 'theirs');
      git(work, 'mv', 'renamed.md', 'by-them.md');
      commitAll('theirs');
      git(work, 'switch', '-q', 'main');
      git(work, 'mv', 'renamed.md', 'by-me.md');
      commitAll('mine');
      expect(() => git(work, 'merge', '--no-edit', 'theirs')).toThrow();

      const conflicts = await merge.conflicts(work);

      expect(conflicts).toMatchObject([
        { path: 'by-me.md', kind: 'deleted-by-them', oursMode: '100644', theirsMode: null },
        { path: 'by-them.md', kind: 'deleted-by-us', oursMode: null, theirsMode: '100644' }
      ]);
    });

    it('leaves out a file both sides deleted', async () => {
      write('renamed.md', 'text\n');
      commitAll('base');
      git(work, 'switch', '-q', '-c', 'theirs');
      git(work, 'mv', 'renamed.md', 'by-them.md');
      commitAll('theirs');
      git(work, 'switch', '-q', 'main');
      git(work, 'mv', 'renamed.md', 'by-me.md');
      commitAll('mine');
      expect(() => git(work, 'merge', '--no-edit', 'theirs')).toThrow();
      const paths = async () => (await merge.conflicts(work)).map(({ path }) => path);

      // In the index, with only a base; and removed from it, which records it as resolved.
      expect(git(work, 'ls-files', '-u', 'renamed.md')).toContain('renamed.md');
      expect(await paths()).toEqual([ 'by-me.md', 'by-them.md' ]);
      git(work, 'update-index', '--force-remove', 'renamed.md');
      expect(git(work, 'ls-files', '--resolve-undo')).toContain('renamed.md');
      expect(await paths()).toEqual([ 'by-me.md', 'by-them.md' ]);
    });

    it('reads every kind of name', async () => {
      const names = [ 'tab\there.md', 'line\nbreak.md', 'привет мир.md', 'space and "quote".md' ];
      names.forEach(name => write(name, 'base\n'));
      commitAll('base');
      git(work, 'switch', '-q', '-c', 'theirs');
      names.forEach(name => write(name, 'theirs\n'));
      commitAll('theirs');
      git(work, 'switch', '-q', 'main');
      names.forEach(name => write(name, 'mine\n'));
      commitAll('mine');
      expect(() => git(work, 'merge', '--no-edit', 'theirs')).toThrow();
      git(work, 'add', '--', names[0] ?? '');

      const conflicts = await merge.conflicts(work);

      expect(conflicts.map(({ path }) => path)).toEqual([ ...names ].sort());
      expect(conflicts.find(({ path }) => path === names[0])).toMatchObject({ kind: 'both-changed', resolved: true });
      expect(conflicts.find(({ path }) => path === names[1])).toMatchObject({ kind: 'both-changed', resolved: false });
      expect(await merge.mergedWithoutConflicts(work, new Set(names))).toEqual([]);
    });

    it('sorts by path, comparing code units', async () => {
      const names = [ 'b.md', 'B.md', 'a/z.md', 'a.md' ];
      names.forEach(name => {
        mkdirSync(join(work, 'a'), { recursive: true });
        write(name, 'base\n');
      });
      commitAll('base');
      git(work, 'switch', '-q', '-c', 'theirs');
      names.forEach(name => write(name, 'theirs\n'));
      commitAll('theirs');
      git(work, 'switch', '-q', 'main');
      names.forEach(name => write(name, 'mine\n'));
      commitAll('mine');
      expect(() => git(work, 'merge', '--no-edit', 'theirs')).toThrow();
      git(work, 'add', 'a/z.md');

      expect((await merge.conflicts(work)).map(({ path }) => path)).toEqual([ 'B.md', 'a.md', 'a/z.md', 'b.md' ]);
    });

    it('forgets what an earlier merge resolved', async () => {
      conflictingMerge();
      git(work, 'add', 'both.md');
      git(work, 'rm', '-q', 'gone.md');
      commitAll('merged');
      git(work, 'branch', '-q', 'later');
      write('first.md', 'mine\n');
      commitAll('mine');
      git(work, 'switch', '-q', 'later');
      write('first.md', 'theirs\n');
      commitAll('theirs');
      git(work, 'switch', '-q', 'main');
      expect(() => git(work, 'merge', '--no-edit', 'later')).toThrow();

      expect((await merge.conflicts(work)).map(({ path }) => path)).toEqual([ 'first.md' ]);
    });

    it('has no size for a submodule', async () => {
      const pointAt = (oid: string, message: string) => {
        git(work, 'update-index', '--add', '--cacheinfo', `160000,${oid},module`);
        git(work, 'commit', '-q', '-m', message);
      };
      const base = git(work, 'rev-parse', 'HEAD');
      mkdirSync(join(work, 'module'));
      pointAt(base, 'base');
      git(work, 'switch', '-q', '-c', 'theirs');
      write('first.md', 'theirs\n');
      commitAll('a commit for theirs');
      pointAt(git(work, 'rev-parse', 'HEAD'), 'theirs');
      git(work, 'switch', '-q', 'main');
      write('first.md', 'mine\n');
      commitAll('a commit for mine');
      pointAt(git(work, 'rev-parse', 'HEAD'), 'mine');
      expect(() => git(work, 'merge', '--no-edit', 'theirs')).toThrow();

      const conflict = (await merge.conflicts(work)).find(({ path }) => path === 'module');

      expect(conflict).toMatchObject({ kind: 'both-changed', oursMode: '160000', oursSize: null, theirsSize: null });
    });

    it('lists what merged without conflicts', async () => {
      conflictingMerge();
      write('theirs-only.md', 'x\n');
      git(work, 'add', 'theirs-only.md');
      git(work, 'rm', '-q', '--cached', 'first.md');
      const conflicting = new Set((await merge.conflicts(work)).map(({ path }) => path));

      expect(await merge.mergedWithoutConflicts(work, conflicting)).toEqual([
        'clean.md',
        'first.md',
        'theirs-only.md'
      ]);
    });

    it('leaves the comment lines out of the message', async () => {
      conflictingMerge();
      expect(readFileSync(join(work, '.git', 'MERGE_MSG'), 'utf8')).toContain('# Conflicts:');

      expect(await merge.mergeMessage(work)).toBe('Merge branch \'theirs\'');
    });

    describe('canWriteMarkers', () => {
      /** A conflict in `a.md` with these contents, with git's `merge` to bring it about. */
      const conflictWith = async (mine: string, theirs: string) => {
        write('a.md', 'base\n');
        commitAll('base');
        git(work, 'switch', '-q', '-c', 'theirs');
        write('a.md', theirs);
        commitAll('theirs');
        git(work, 'switch', '-q', 'main');
        write('a.md', mine);
        commitAll('mine');
        expect(() => git(work, 'merge', '--no-edit', 'theirs')).toThrow();
        const [ entry ] = await merge.conflicts(work);
        if (entry === undefined) {
          throw new Error('expected a conflict');
        }
        return entry;
      };

      it('is true for text', async () => {
        expect(await merge.canWriteMarkers(work, await conflictWith('mine\n', 'theirs\n'))).toBe(true);
      });

      it('is false when our version has a NUL byte', async () => {
        expect(await merge.canWriteMarkers(work, await conflictWith('mi\0ne\n', 'theirs\n'))).toBe(false);
      });

      it('is false when only their version has a NUL byte', async () => {
        expect(await merge.canWriteMarkers(work, await conflictWith('mine\n', 'thei\0rs\n'))).toBe(false);
      });

      it('is true for a file both added, which has no base', async () => {
        conflictingMerge();
        const both = (await merge.conflicts(work)).find(({ path }) => path === 'both.md');
        expect(both?.baseOid).toBeNull();

        expect(both !== undefined && await merge.canWriteMarkers(work, both)).toBe(true);
      });

      it('is false for a file one side deleted', async () => {
        conflictingMerge();
        const gone = (await merge.conflicts(work)).find(({ path }) => path === 'gone.md');

        expect(gone !== undefined && await merge.canWriteMarkers(work, gone)).toBe(false);
      });
    });

    it('tells a merge from a rebase', async () => {
      expect(await merge.mergeInProgress(work)).toBe(false);
      mkdirSync(join(work, '.git', 'rebase-merge'));
      expect(await merge.mergeInProgress(work)).toBe(false);
      rmSync(join(work, '.git', 'rebase-merge'), { recursive: true });

      conflictingMerge();

      expect(await merge.mergeInProgress(work)).toBe(true);
    });

    it('does not take a branch called MERGE_HEAD for a merge', async () => {
      git(work, 'branch', 'MERGE_HEAD');

      expect(await merge.mergeInProgress(work)).toBe(false);
    });

    it('names the branch and its upstream', async () => {
      expect(await merge.branchAndUpstream(work)).toEqual({ branch: 'main', upstream: null });

      await merge.adoptUpstream(work, 'main');
      expect(await merge.branchAndUpstream(work)).toEqual({ branch: 'main', upstream: 'origin/main' });

      git(work, 'checkout', '-q', '--detach');
      expect(await merge.branchAndUpstream(work)).toEqual({ branch: null, upstream: null });
    });

    it('has an empty message when git prepared none', async () => {
      conflictingMerge();
      rmSync(join(work, '.git', 'MERGE_MSG'));

      expect(await merge.mergeMessage(work)).toBe('');
    });
  });

  it('refreshIndex updates stale entries, and accepts modified and conflicting files', async () => {
    utimesSync(join(work, 'first.md'), new Date(1_000_000), new Date(1_000_000));
    expect(git(work, 'diff-files', '--name-only')).toBe('first.md');

    await merge.refreshIndex(work);

    expect(git(work, 'diff-files', '--name-only')).toBe('');
    write('first.md', 'changed\n');
    await expect(merge.refreshIndex(work)).resolves.toBeUndefined();
    git(work, 'checkout', '-q', '--', 'first.md');

    conflictingMerge();
    await expect(merge.refreshIndex(work)).resolves.toBeUndefined();
    expect(existsSync(join(work, '.git', 'MERGE_HEAD'))).toBe(true);
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

  describe('merge', () => {
    const UPSTREAM = 'refs/remotes/origin/main';
    const author = { name: 'Ada Lovelace', email: 'ada@example.com' };
    const request = { branch: 'main', upstream: 'origin/main', author };

    /** Makes a commit on `origin/main` as a fetch would bring it, and goes back to `main`. */
    const onUpstream = (change: () => void, message = 'theirs') => {
      git(work, 'checkout', '-q', '--detach', UPSTREAM);
      change();
      commitAll(message);
      git(work, 'update-ref', UPSTREAM, 'HEAD');
      git(work, 'checkout', '-q', 'main');
    };
    /** A symbolic link in the index and on disk, also where git checks links out as plain files. */
    const writeLink = (name: string, target: string) => {
      const oid = execFileSync('git', [ 'hash-object', '-w', '--stdin' ], {
        cwd: work,
        env: gitEnv,
        encoding: 'utf8',
        input: target
      }).trim();
      rmSync(join(work, name), { force: true });
      git(work, 'update-index', '--add', '--cacheinfo', `120000,${oid},${name}`);
      git(work, 'checkout', '--', name);
    };
    const linkTarget = (name: string) =>
      lstatSync(join(work, name)).isSymbolicLink()
        ? readlinkSync(join(work, name))
        : readFileSync(join(work, name), 'utf8');
    const head = () => git(work, 'rev-parse', 'HEAD');
    const mergeHead = () => existsSync(join(work, '.git', 'MERGE_HEAD'));
    const failureOf = (promise: Promise<unknown>) =>
      promise.then(() => {
        throw new Error('expected a failure');
      }, (error: unknown) => error as GitOperationError);

    beforeEach(() => {
      git(work, 'update-ref', UPSTREAM, 'HEAD');
      // The working copy's own identity, which a merge must not use (CA-2).
      git(work, 'config', 'user.name', 'Config Name');
      git(work, 'config', 'user.email', 'config@example.com');
    });

    it('comments its conflict list with #, whatever the working copy\'s configuration says', async () => {
      git(work, 'config', 'core.commentChar', ';');
      onUpstream(() => write('first.md', 'theirs\n'));
      write('first.md', 'mine\n');
      commitAll('mine');

      expect(await merge.merge(work, request)).toEqual({ kind: 'conflicted', commits: 1 });

      expect(readFileSync(join(work, '.git', 'MERGE_MSG'), 'utf8')).toContain('# Conflicts:');
      expect(await merge.mergeMessage(work)).toBe('Merge remote-tracking branch \'origin/main\'');
    });

    it('says already up to date', async () => {
      write('first.md', 'mine\n');
      commitAll('mine');
      const before = head();

      expect(await merge.merge(work, request)).toEqual({ kind: 'up-to-date' });
      expect(head()).toBe(before);
    });

    it('fast-forwards and counts the commits', async () => {
      onUpstream(() => write('first.md', 'two\n'));
      onUpstream(() => write('first.md', 'three\n'));

      expect(await merge.merge(work, request)).toEqual({ kind: 'fast-forward', commits: 2 });
      expect(head()).toBe(git(work, 'rev-parse', UPSTREAM));
      expect(readFileSync(join(work, 'first.md'), 'utf8')).toBe('three\n');
    });

    it('makes a merge commit with git\'s words, as the author', async () => {
      onUpstream(() => write('theirs.md', 'theirs\n'));
      write('mine.md', 'mine\n');
      commitAll('mine');

      const result = await merge.merge(work, request);

      expect(result).toEqual({ kind: 'merged', commits: 1, oid: head() });
      expect(git(work, 'log', '-1', '--format=%B')).toBe('Merge remote-tracking branch \'origin/main\'');
      expect(git(work, 'log', '-1', '--format=%an <%ae>|%cn <%ce>')).toBe(
        'Ada Lovelace <ada@example.com>|Ada Lovelace <ada@example.com>'
      );
      expect(git(work, 'rev-parse', 'HEAD^2')).toBe(git(work, 'rev-parse', UPSTREAM));
    });

    it('says into for a branch other than main', async () => {
      git(work, 'checkout', '-q', '-b', 'feature');
      git(work, 'update-ref', 'refs/remotes/origin/feature', 'HEAD');
      git(work, 'checkout', '-q', '--detach', 'refs/remotes/origin/feature');
      write('theirs.md', 'theirs\n');
      commitAll('theirs');
      git(work, 'update-ref', 'refs/remotes/origin/feature', 'HEAD');
      git(work, 'checkout', '-q', 'feature');
      write('mine.md', 'mine\n');
      commitAll('mine');

      await merge.merge(work, { branch: 'feature', upstream: 'origin/feature', author });

      expect(git(work, 'log', '-1', '--format=%B')).toBe(
        'Merge remote-tracking branch \'origin/feature\' into feature'
      );
    });

    it('stops at a conflict and leaves MERGE_HEAD, with the same message', async () => {
      onUpstream(() => write('first.md', 'theirs\n'));
      write('first.md', 'mine\n');
      commitAll('mine');
      const before = head();

      expect(await merge.merge(work, request)).toEqual({ kind: 'conflicted', commits: 1 });
      expect(head()).toBe(before);
      expect(git(work, 'rev-parse', 'MERGE_HEAD')).toBe(git(work, 'rev-parse', UPSTREAM));
      expect(readFileSync(join(work, '.git', 'MERGE_MSG'), 'utf8').split('\n')[0]).toBe(
        'Merge remote-tracking branch \'origin/main\''
      );
    });

    it('writes plain markers with branch names, whatever the config says', async () => {
      git(work, 'config', 'merge.conflictStyle', 'zdiff3');
      onUpstream(() => write('first.md', 'theirs\n'));
      write('first.md', 'mine\n');
      commitAll('mine');

      await merge.merge(work, request);

      expect(readFileSync(join(work, 'first.md'), 'utf8')).toBe(
        '<<<<<<< main\nmine\n=======\ntheirs\n>>>>>>> origin/main\n'
      );

      write('first.md', 'edited\n');
      await merge.writeMarkers(work, 'first.md', { ours: 'mine', theirs: 'theirs' });

      expect(readFileSync(join(work, 'first.md'), 'utf8')).toBe(
        '<<<<<<< mine\nmine\n=======\ntheirs\n>>>>>>> theirs\n'
      );
    });

    it('labels Both added too', async () => {
      onUpstream(() => write('new.md', 'theirs\n'));
      write('new.md', 'mine\n');
      commitAll('mine');

      await merge.merge(work, request);

      expect(git(work, 'ls-files', '-u', '--', 'new.md').split('\n').map(line => line.split('\t')[0].at(-1))).toEqual([
        '2',
        '3'
      ]);
      expect(readFileSync(join(work, 'new.md'), 'utf8')).toBe(
        '<<<<<<< main\nmine\n=======\ntheirs\n>>>>>>> origin/main\n'
      );
    });

    it('leaves a file that is not valid UTF-8 as git wrote it', async () => {
      git(work, 'config', 'merge.conflictStyle', 'zdiff3');
      writeFileSync(join(work, 'latin.md'), Buffer.from('caf\xe9\n', 'latin1'));
      writeLink('link.md', 'base.md');
      commitAll('base');
      git(work, 'update-ref', UPSTREAM, 'HEAD');
      onUpstream(() => {
        writeFileSync(join(work, 'latin.md'), Buffer.from('th\xe9irs\n', 'latin1'));
        writeLink('link.md', 'theirs.md');
      });
      writeFileSync(join(work, 'latin.md'), Buffer.from('m\xefne\n', 'latin1'));
      writeLink('link.md', 'mine.md');
      commitAll('mine');

      expect(await merge.merge(work, request)).toEqual({ kind: 'conflicted', commits: 1 });

      // git's own markers, in the plain style.
      expect(readFileSync(join(work, 'latin.md'))).toEqual(
        Buffer.from(
          `<<<<<<< HEAD\nm\xefne\n=======\nth\xe9irs\n>>>>>>> ${git(work, 'rev-parse', UPSTREAM)}\n`,
          'latin1'
        )
      );
      expect(git(work, 'ls-files', '-u', '--', 'link.md').split('\n').map(line => line.split(' ')[0])).toEqual([
        '120000',
        '120000',
        '120000'
      ]);
      expect(linkTarget('link.md')).toBe('mine.md');
    });

    it('leaves a Markdown file with a NUL byte as git wrote it', async () => {
      // Not `nul.md`, which Windows does not allow.
      writeFileSync(join(work, 'binary.md'), Buffer.from('base\0\n'));
      commitAll('base');
      git(work, 'update-ref', UPSTREAM, 'HEAD');
      onUpstream(() => writeFileSync(join(work, 'binary.md'), Buffer.from('theirs\0\n')));
      writeFileSync(join(work, 'binary.md'), Buffer.from('mine\0\n'));
      commitAll('mine');

      expect(await merge.merge(work, request)).toEqual({ kind: 'conflicted', commits: 1 });

      expect(readFileSync(join(work, 'binary.md'))).toEqual(Buffer.from('mine\0\n'));
      await merge.writeMarkers(work, 'binary.md', { ours: 'main', theirs: 'origin/main' });
      expect(readFileSync(join(work, 'binary.md'))).toEqual(Buffer.from('mine\0\n'));
    });

    it('leaves other files as git wrote them', async () => {
      write('notes.txt', 'base\n');
      write('clean.md', 'a\nb\nc\n');
      write('gone.md', 'x\n');
      commitAll('base');
      git(work, 'update-ref', UPSTREAM, 'HEAD');
      onUpstream(() => {
        write('notes.txt', 'theirs\n');
        write('clean.md', 'a\nb\nC\n');
        write('first.md', 'theirs\n');
        git(work, 'rm', '-q', 'gone.md');
      });
      write('notes.txt', 'mine\n');
      write('clean.md', 'A\nb\nc\n');
      write('first.md', 'mine\n');
      write('gone.md', 'x changed\n');
      commitAll('mine');

      expect(await merge.merge(work, request)).toEqual({ kind: 'conflicted', commits: 1 });

      // Not Markdown: nothing shows its markers, so they stay git's (GC-15),
      // labelled with the commit that was merged.
      expect(readFileSync(join(work, 'notes.txt'), 'utf8')).toBe(
        `<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> ${git(work, 'rev-parse', UPSTREAM)}\n`
      );
      expect(readFileSync(join(work, 'first.md'), 'utf8')).toBe(
        '<<<<<<< main\nmine\n=======\ntheirs\n>>>>>>> origin/main\n'
      );
      expect(readFileSync(join(work, 'clean.md'), 'utf8')).toBe('A\nb\nC\n');
      expect(readFileSync(join(work, 'gone.md'), 'utf8')).toBe('x changed\n');
      await merge.writeMarkers(work, 'gone.md', { ours: 'main', theirs: 'origin/main' });
      expect(readFileSync(join(work, 'gone.md'), 'utf8')).toBe('x changed\n');
    });

    it('merges the remote branch when a local branch has its name', async () => {
      git(work, 'branch', 'origin/main');
      onUpstream(() => write('first.md', 'two\n'));

      expect(await merge.merge(work, request)).toEqual({ kind: 'fast-forward', commits: 1 });
      expect(head()).toBe(git(work, 'rev-parse', UPSTREAM));
    });

    it('merges in a shallow single-branch clone', async () => {
      const remote = join(root, 'remote.git');
      git(root, 'clone', '-q', '--bare', work, remote);
      const shallow = join(root, 'shallow');
      git(
        root,
        'clone',
        '-q',
        '--depth',
        '1',
        '--single-branch',
        '--branch',
        'main',
        pathToFileURL(remote).href,
        shallow
      );
      write('first.md', 'theirs\n');
      commitAll('theirs');
      git(work, 'push', '-q', remote, 'main');
      writeFileSync(join(shallow, 'mine.md'), 'mine\n');
      git(shallow, 'add', '-A');
      git(shallow, 'commit', '-q', '-m', 'mine');
      git(shallow, 'fetch', '-q');

      const result = await merge.merge(shallow, request);

      expect(result).toEqual({ kind: 'merged', commits: 1, oid: git(shallow, 'rev-parse', 'HEAD') });
      expect(readFileSync(join(shallow, 'first.md'), 'utf8')).toBe('theirs\n');
      expect(readFileSync(join(shallow, 'mine.md'), 'utf8')).toBe('mine\n');
    });

    it('merges unrelated histories', async () => {
      git(work, 'checkout', '-q', '--orphan', 'other');
      git(work, 'rm', '-q', '-r', '--cached', '.');
      rmSync(join(work, 'first.md'));
      rmSync(join(work, '.gitignore'));
      write('other.md', 'other\n');
      commitAll('other');
      git(work, 'update-ref', UPSTREAM, 'HEAD');
      git(work, 'checkout', '-q', 'main');

      expect(await merge.merge(work, request)).toEqual({ kind: 'merged', commits: 1, oid: head() });
      expect(readFileSync(join(work, 'other.md'), 'utf8')).toBe('other\n');
    });

    it('ignores merge.ff=only and merge.autoStash in the config', async () => {
      git(work, 'config', 'merge.ff', 'only');
      git(work, 'config', 'merge.autoStash', 'true');
      onUpstream(() => write('theirs.md', 'theirs\n'));
      write('mine.md', 'mine\n');
      commitAll('mine');

      expect(await merge.merge(work, request)).toMatchObject({ kind: 'merged' });
      expect(git(work, 'stash', 'list')).toBe('');
    });

    it('a fast-forward does not overwrite an ignored file', async () => {
      onUpstream(() => {
        write('ignored.log', 'theirs\n');
        git(work, 'add', '-f', 'ignored.log');
      });
      write('ignored.log', 'keep me\n');
      const before = head();

      const failure = await failureOf(merge.merge(work, request));

      expect(failure).toBeInstanceOf(GitOperationError);
      expect(failure.code).toBe('merge-blocked');
      expect(failure.params).toEqual({ paths: 'ignored.log' });
      expect(head()).toBe(before);
      expect(readFileSync(join(work, 'ignored.log'), 'utf8')).toBe('keep me\n');
    });

    it('a true merge does not overwrite an ignored file, or an ignored folder', async () => {
      write('.gitignore', 'ignored.log\nbuild/\n');
      commitAll('ignore build');
      git(work, 'update-ref', UPSTREAM, 'HEAD');
      onUpstream(() => {
        write('ignored.log', 'theirs\n');
        write('build', 'a file\n');
        git(work, 'add', '-f', 'ignored.log', 'build');
      });
      write('mine.md', 'mine\n');
      commitAll('mine');
      write('ignored.log', 'keep me\n');
      mkdirSync(join(work, 'build'));
      write('build/out.txt', 'keep me too\n');
      const before = head();

      const failure = await failureOf(merge.merge(work, request));

      expect(failure.code).toBe('merge-blocked');
      expect(failure.params['paths']?.split('\n').sort()).toEqual([ 'build', 'ignored.log' ]);
      expect(head()).toBe(before);
      expect(mergeHead()).toBe(false);
      expect(readFileSync(join(work, 'ignored.log'), 'utf8')).toBe('keep me\n');
      expect(readFileSync(join(work, 'build', 'out.txt'), 'utf8')).toBe('keep me too\n');
    });

    it('a file where a folder on the way must be stops the merge', async () => {
      write('.gitignore', 'ignored.log\nnotes\n');
      commitAll('ignore notes');
      git(work, 'update-ref', UPSTREAM, 'HEAD');
      onUpstream(() => {
        mkdirSync(join(work, 'notes'));
        write('notes/a.md', 'theirs\n');
        git(work, 'add', '-f', 'notes/a.md');
      });
      // A checkout of `main` keeps the ignored folder; the user's file replaces it.
      rmSync(join(work, 'notes'), { recursive: true, force: true });
      write('notes', 'keep me\n');
      const before = head();

      const failure = await failureOf(merge.merge(work, request));

      expect(failure.code).toBe('merge-blocked');
      expect(failure.params).toEqual({ paths: 'notes' });
      expect(head()).toBe(before);
      expect(readFileSync(join(work, 'notes'), 'utf8')).toBe('keep me\n');
    });

    it('removes a file both sides deleted', async () => {
      write('old.md', 'old\n');
      commitAll('base');
      git(work, 'update-ref', UPSTREAM, 'HEAD');
      onUpstream(() => git(work, 'mv', 'old.md', 'theirs.md'));
      git(work, 'mv', 'old.md', 'mine.md');
      commitAll('mine');

      expect(await merge.merge(work, request)).toEqual({ kind: 'conflicted', commits: 1 });

      expect(git(work, 'ls-files', '-s', '--', 'old.md')).toBe('');
      expect(git(work, 'ls-files', '-u').split('\n').map(line => line.split('\t')[1])).toEqual([
        'mine.md',
        'theirs.md'
      ]);
      // Not a resolved file either.
      expect(git(work, 'ls-files', '--resolve-undo')).toBe('');
    });

    it('merges the commit the checks saw, also when a fetch moves the branch meanwhile', async () => {
      onUpstream(() => write('first.md', 'checked\n'));
      const checked = git(work, 'rev-parse', UPSTREAM);
      onUpstream(() => {
        write('ignored.log', 'theirs\n');
        git(work, 'add', '-f', 'ignored.log');
      });
      const moved = git(work, 'rev-parse', UPSTREAM);
      git(work, 'update-ref', UPSTREAM, checked);
      write('ignored.log', 'keep me\n');
      // A fetch moves the branch just as git starts to merge.
      class FetchingLocalGit extends LocalGit {
        override run(cwd: string, args: string[], options?: LocalRunOptions) {
          if (args.includes('merge')) {
            git(work, 'update-ref', UPSTREAM, moved);
          }
          return super.run(cwd, args, options);
        }
      }
      const racing = new GitMerge(new FetchingLocalGit(new GitRunner()), { gitTimeoutMs: 60_000 } as GitOptions);

      expect(await racing.merge(work, request)).toEqual({ kind: 'fast-forward', commits: 1 });

      expect(head()).toBe(checked);
      expect(git(work, 'rev-parse', UPSTREAM)).toBe(moved);
      expect(readFileSync(join(work, 'ignored.log'), 'utf8')).toBe('keep me\n');
    });

    it('a new path that is not valid UTF-8 stops the merge', async () => {
      const blob = git(work, 'hash-object', '-w', 'first.md');
      const tree = execFileSync('git', [ 'mktree', '-z' ], {
        cwd: work,
        env: gitEnv,
        input: Buffer.concat([
          Buffer.from(git(work, 'ls-tree', '-z', 'HEAD').replace(/\0$/, '') + '\0'),
          Buffer.from(`100644 blob ${blob}\tcaf`),
          Buffer.from([ 0xe9 ]),
          Buffer.from('.md\0')
        ])
      }).toString().trim();
      git(work, 'update-ref', UPSTREAM, git(work, 'commit-tree', tree, '-p', 'HEAD', '-m', 'latin-1 name'));
      const before = head();

      const failure = await failureOf(merge.merge(work, request));

      expect(failure.code).toBe('merge-blocked');
      expect(failure.params).toEqual({ paths: 'caf�.md' });
      expect(head()).toBe(before);
    });

    it('knows when a merge commit is needed', async () => {
      expect(await merge.needsMergeCommit(work, 'origin/main')).toBe(false);
      onUpstream(() => write('theirs.md', 'theirs\n'));
      expect(await merge.needsMergeCommit(work, 'origin/main')).toBe(false);
      write('mine.md', 'mine\n');
      commitAll('mine');
      expect(await merge.needsMergeCommit(work, 'origin/main')).toBe(true);
    });

    it('knows when there is nothing to merge', async () => {
      expect(await merge.isUpToDate(work, 'origin/main')).toBe(true);
      expect(await merge.hasRemoteBranch(work, 'main')).toBe(true);
      expect(await merge.hasRemoteBranch(work, 'missing')).toBe(false);
      write('mine.md', 'mine\n');
      commitAll('mine');
      expect(await merge.isUpToDate(work, 'origin/main')).toBe(true);
      onUpstream(() => write('theirs.md', 'theirs\n'));
      expect(await merge.isUpToDate(work, 'origin/main')).toBe(false);
    });

    it('adopts an upstream, also for a branch with a dot in its name', async () => {
      const local = new LocalGit(new GitRunner());

      await merge.adoptUpstream(work, 'main');
      await merge.adoptUpstream(work, 'release.1');

      expect(await local.upstreamOf(work, 'main')).toBe('refs/heads/main');
      expect(await local.upstreamOf(work, 'release.1')).toBe('refs/heads/release.1');
      expect(git(work, 'config', '--get', 'branch.release.1.remote')).toBe('origin');
    });
  });
});
