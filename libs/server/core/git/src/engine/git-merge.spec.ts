import { PathRefusedError } from '@front-burner/server-core-storage';
import type { GitResolution } from '@front-burner/shared-contracts';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
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
          theirsSize: sizeOf('theirs!\n'),
          resolution: null,
          edited: false
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

    describe('readVersion', () => {
      it('reads a blob by its oid', async () => {
        const oid = git(work, 'rev-parse', ':first.md');
        const bytes = await merge.readVersion(work, oid);

        expect(bytes).toEqual(Buffer.from('one\n', 'utf8'));
      });

      it('throws for an oid that is not a blob', async () => {
        const head = git(work, 'rev-parse', 'HEAD');

        await expect(merge.readVersion(work, head)).rejects.toThrow('git cat-file blob');
      });

      it('returns the raw bytes of a blob that is not valid UTF-8', async () => {
        writeFileSync(join(work, 'latin.md'), Buffer.from([ 0x63, 0xe9, 0x0a ]));
        git(work, 'add', 'latin.md');
        const oid = git(work, 'rev-parse', ':latin.md');

        expect(await merge.readVersion(work, oid)).toEqual(Buffer.from([ 0x63, 0xe9, 0x0a ]));
      });

      it('returns the raw bytes of a blob that contains U+FFFD', async () => {
        writeFileSync(join(work, 'replacement.md'), Buffer.from([ 0x61, 0xef, 0xbf, 0xbd, 0x62, 0x0a ]));
        git(work, 'add', 'replacement.md');
        const oid = git(work, 'rev-parse', ':replacement.md');

        expect(await merge.readVersion(work, oid)).toEqual(Buffer.from([ 0x61, 0xef, 0xbf, 0xbd, 0x62, 0x0a ]));
      });

      it('throws for a non-existent oid', async () => {
        await expect(merge.readVersion(work, '0000000000000000000000000000000000000000')).rejects.toThrow(
          'git cat-file blob'
        );
      });

      it('returns the raw bytes including BOM', async () => {
        const BOM = Buffer.from([ 0xef, 0xbb, 0xbf ]);
        writeFileSync(join(work, 'bom.md'), Buffer.concat([ BOM, Buffer.from('hello\n', 'utf8') ]));
        git(work, 'add', 'bom.md');
        const oid = git(work, 'rev-parse', ':bom.md');

        expect(await merge.readVersion(work, oid)).toEqual(Buffer.concat([ BOM, Buffer.from('hello\n', 'utf8') ]));
      });

      it('returns the raw bytes with CRLF line endings', async () => {
        writeFileSync(join(work, 'crlf.md'), 'line1\r\nline2\r\n');
        git(work, 'add', 'crlf.md');
        const oid = git(work, 'rev-parse', ':crlf.md');

        expect(await merge.readVersion(work, oid)).toEqual(Buffer.from('line1\r\nline2\r\n', 'utf8'));
      });

      it('throws when git itself fails', async () => {
        const local = new LocalGit(new GitRunner());
        const run = local.run.bind(local);
        const failingMerge = new GitMerge(local, { gitTimeoutMs: 60_000 } as GitOptions);
        vi.spyOn(local, 'run').mockImplementation(async (cwd, args, options) => {
          if (args[0] === 'cat-file') {
            return {
              exitCode: null,
              stdout: '',
              stdoutRaw: Buffer.alloc(0),
              stdoutBytes: 0,
              stderr: 'spawn git: No such file or directory',
              timedOut: false
            };
          }
          return run(cwd, args, options);
        });

        await expect(failingMerge.readVersion(work, 'abc123')).rejects.toThrow('git cat-file blob abc123 failed');
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

    it('preserves the BOM on a conflicting Markdown file', async () => {
      const BOM = Buffer.from([ 0xef, 0xbb, 0xbf ]);
      writeFileSync(join(work, 'bom.md'), Buffer.concat([ BOM, Buffer.from('# Title\nbase\n', 'utf8') ]));
      commitAll('base');
      git(work, 'update-ref', UPSTREAM, 'HEAD');
      onUpstream(() => {
        writeFileSync(join(work, 'bom.md'), Buffer.concat([ BOM, Buffer.from('# Title\ntheirs\n', 'utf8') ]));
      });
      writeFileSync(join(work, 'bom.md'), Buffer.concat([ BOM, Buffer.from('# Title\nmine\n', 'utf8') ]));
      commitAll('mine');

      expect(await merge.merge(work, request)).toEqual({ kind: 'conflicted', commits: 1 });

      const content = readFileSync(join(work, 'bom.md'));
      expect(content.slice(0, 3)).toEqual(BOM);
      expect(content.toString('utf8')).toContain('<<<<<<< main');
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

  describe('resolve', () => {
    /** A file's content, a symbolic link's target, or `null` for no file. */
    type Content = string | Buffer | { link: string; } | null;
    type Files = Record<string, Content>;

    function put(files: Files): void {
      for (const [ path, content ] of Object.entries(files)) {
        const absolute = join(work, path);
        rmSync(absolute, { force: true });
        if (content === null) {
          continue;
        }
        mkdirSync(join(absolute, '..'), { recursive: true });
        if (typeof content === 'object' && 'link' in content) {
          symlinkSync(content.link, absolute);
        } else {
          writeFileSync(absolute, content);
        }
      }
    }

    /** Commits `base`, then `theirs` on the branch `theirs` and `mine` on `main`, and merges with a conflict. */
    function diverged(base: Files, mine: Files, theirs: Files): void {
      put(base);
      commitAll('base');
      git(work, 'switch', '-q', '-c', 'theirs');
      put(theirs);
      commitAll('theirs');
      git(work, 'switch', '-q', 'main');
      put(mine);
      commitAll('mine');
      expect(() => git(work, 'merge', '--no-edit', 'theirs')).toThrow();
    }

    const entryOf = async (path: string) => {
      const entry = (await merge.conflicts(work)).find(conflict => conflict.path === path);
      expect(entry).toBeDefined();
      return entry as NonNullable<typeof entry>;
    };
    const resolve = async (path: string, resolution: GitResolution) =>
      merge.resolve(work, await entryOf(path), resolution);
    const staged = (path: string) => git(work, 'ls-files', '--stage', '--', path);
    const indexed = (path: string) => execFileSync('git', [ 'show', `:0:${path}` ], { cwd: work, env: gitEnv });
    const onDisk = (path: string) => readFileSync(join(work, path), 'utf8');

    const bothChanged = () =>
      diverged({ 'edited.md': 'base\n' }, { 'edited.md': 'mine\n' }, { 'edited.md': 'theirs\n' });

    it('marks a file as resolved with its saved content', async () => {
      bothChanged();
      writeFileSync(join(work, 'edited.md'), 'both, by hand\n');

      await resolve('edited.md', 'mark-resolved');

      expect(indexed('edited.md').toString()).toBe('both, by hand\n');
      expect(onDisk('edited.md')).toBe('both, by hand\n');
      expect(await entryOf('edited.md')).toMatchObject({ kind: 'both-changed', resolved: true });
    });

    it('uses my version', async () => {
      bothChanged();

      await resolve('edited.md', 'ours');

      expect(onDisk('edited.md')).toBe('mine\n');
      expect(indexed('edited.md').toString()).toBe('mine\n');
      expect(await entryOf('edited.md')).toMatchObject({ resolved: true });
    });

    it('uses their version, over edits that were saved', async () => {
      bothChanged();
      writeFileSync(join(work, 'edited.md'), 'saved edits\n');

      await resolve('edited.md', 'theirs');

      expect(onDisk('edited.md')).toBe('theirs\n');
      expect(indexed('edited.md').toString()).toBe('theirs\n');
    });

    it('uses either version of a file both added', async () => {
      diverged({ 'other.md': 'base\n' }, { 'new.md': 'mine\n' }, { 'new.md': 'theirs\n' });
      expect((await entryOf('new.md')).kind).toBe('both-added');

      await resolve('new.md', 'theirs');

      expect(onDisk('new.md')).toBe('theirs\n');
      expect(await entryOf('new.md')).toMatchObject({ kind: 'both-added', resolved: true });
    });

    it('keeps a file they deleted', async () => {
      diverged({ 'gone.md': 'base\n' }, { 'gone.md': 'mine\n' }, { 'gone.md': null });

      await resolve('gone.md', 'keep');

      expect(onDisk('gone.md')).toBe('mine\n');
      expect(indexed('gone.md').toString()).toBe('mine\n');
      expect(await entryOf('gone.md')).toMatchObject({ kind: 'deleted-by-them', resolved: true });
    });

    it('keeps a file I deleted', async () => {
      diverged({ 'gone.md': 'base\n' }, { 'gone.md': null }, { 'gone.md': 'theirs\n' });
      expect(existsSync(join(work, 'gone.md'))).toBe(true);
      rmSync(join(work, 'gone.md'));

      await resolve('gone.md', 'keep');

      expect(onDisk('gone.md')).toBe('theirs\n');
      expect(await entryOf('gone.md')).toMatchObject({ kind: 'deleted-by-us', resolved: true });
    });

    it('deletes a file', async () => {
      diverged({ 'gone.md': 'base\n' }, { 'gone.md': null }, { 'gone.md': 'theirs\n' });

      await resolve('gone.md', 'delete');

      expect(existsSync(join(work, 'gone.md'))).toBe(false);
      expect(staged('gone.md')).toBe('');
      expect(git(work, 'status', '--porcelain', '--', 'gone.md')).toBe('');
    });

    it('deletes a file that is already gone', async () => {
      diverged({ 'gone.md': 'base\n' }, { 'gone.md': 'mine\n' }, { 'gone.md': null });
      rmSync(join(work, 'gone.md'));

      await resolve('gone.md', 'delete');

      expect(staged('gone.md')).toBe('');
    });

    it('still lists a deleted file as resolved', async () => {
      diverged({ 'gone.md': 'base\n' }, { 'gone.md': 'mine\n' }, { 'gone.md': null });

      await resolve('gone.md', 'delete');

      expect(await merge.conflicts(work)).toMatchObject([
        { path: 'gone.md', kind: 'deleted-by-them', resolved: true }
      ]);
    });

    it('deletes the last file of a folder', async () => {
      diverged({ 'folder/only.md': 'base\n' }, { 'folder/only.md': 'mine\n' }, { 'folder/only.md': null });

      await resolve('folder/only.md', 'delete');

      // An empty folder, which git does not track: only the deletion is to commit.
      expect(existsSync(join(work, 'folder/only.md'))).toBe(false);
      expect(git(work, 'ls-files', '--', 'folder')).toBe('');
      expect(git(work, 'status', '--porcelain', '--untracked-files=all', '--', 'folder')).toBe('D  folder/only.md');
    });

    it('resolves a binary file and a symbolic link with a whole version', async () => {
      const mine = Buffer.from([ 0, 1, 2, 0xff, 0x0d, 0x0a ]);
      const theirs = Buffer.from([ 0, 9, 8, 0xfe, 0x0a ]);
      diverged(
        { 'image.png': Buffer.from([ 0, 0 ]), 'link.md': { link: 'base.md' } },
        { 'image.png': mine, 'link.md': { link: 'mine.md' } },
        { 'image.png': theirs, 'link.md': { link: 'theirs.md' } }
      );

      await resolve('image.png', 'ours');
      await resolve('link.md', 'theirs');

      expect(readFileSync(join(work, 'image.png')).equals(mine)).toBe(true);
      expect(indexed('image.png').equals(mine)).toBe(true);
      expect(lstatSync(join(work, 'link.md')).isSymbolicLink()).toBe(true);
      expect(readlinkSync(join(work, 'link.md'))).toBe('theirs.md');
      expect(staged('link.md')).toMatch(/^120000 /);
    });

    it('resolves a file with a name like a pathspec', async () => {
      const files = (content: string) => ({ ':(top)x.md': content, 'x.md': content, '*.md': content });
      diverged(files('base\n'), files('mine\n'), files('theirs\n'));

      await resolve(':(top)x.md', 'theirs');
      await resolve('*.md', 'ours');

      expect(onDisk(':(top)x.md')).toBe('theirs\n');
      expect(onDisk('*.md')).toBe('mine\n');
      expect(await entryOf('x.md')).toMatchObject({ resolved: false });
      expect(onDisk('x.md')).toContain('<<<<<<<');
    });

    it('leaves the other files alone', async () => {
      diverged(
        { 'a.md': 'base\n', 'b.md': 'base\n' },
        { 'a.md': 'mine\n', 'b.md': 'mine\n' },
        { 'a.md': 'theirs\n', 'b.md': 'theirs\n' }
      );
      writeFileSync(join(work, 'b.md'), 'edited\n');
      const before = git(work, 'ls-files', '--stage', '--', 'b.md');

      await resolve('a.md', 'theirs');

      expect(onDisk('b.md')).toBe('edited\n');
      expect(git(work, 'ls-files', '--stage', '--', 'b.md')).toBe(before);
      expect(await entryOf('b.md')).toMatchObject({ resolved: false });
    });

    /** A `GitMerge` whose git fails at the command that has `step` among its arguments. */
    const failing = (step: string) => {
      const local = new LocalGit(new GitRunner());
      const checked = local.checked.bind(local);
      vi.spyOn(local, 'checked').mockImplementation((cwd: string, args: string[], options?: LocalRunOptions) =>
        args.includes(step)
          ? Promise.reject(new GitOperationError('timeout', 'too slow'))
          : checked(cwd, args, options)
      );
      return new GitMerge(local, { gitTimeoutMs: 60_000 } as GitOptions);
    };
    const backup = () => join(work, '.git', 'front-burner-resolving');

    describe('when git fails partway', () => {
      it.each(
        [
          [ 'theirs', 'add' ],
          [ 'ours', 'checkout' ]
        ] as const
      )('puts the file and its conflict back after %s fails at %s', async (resolution, step) => {
        bothChanged();
        writeFileSync(join(work, 'edited.md'), 'saved edits\n');
        const stages = staged('edited.md');

        await expect(failing(step).resolve(work, await entryOf('edited.md'), resolution))
          .rejects.toMatchObject({ code: 'timeout' });

        expect(onDisk('edited.md')).toBe('saved edits\n');
        expect(staged('edited.md')).toBe(stages);
        expect(git(work, 'ls-files', '--resolve-undo')).toBe('');
        expect(await entryOf('edited.md')).toMatchObject({ resolved: false });
        expect(existsSync(backup())).toBe(false);
      });

      it('puts back a file it was deleting', async () => {
        diverged({ 'gone.md': 'base\n' }, { 'gone.md': 'mine\n' }, { 'gone.md': null });
        const stages = staged('gone.md');

        await expect(failing('--force-remove').resolve(work, await entryOf('gone.md'), 'delete'))
          .rejects.toMatchObject({ code: 'timeout' });

        expect(onDisk('gone.md')).toBe('mine\n');
        expect(staged('gone.md')).toBe(stages);
        expect(existsSync(backup())).toBe(false);
      });

      it('puts back the conflict that git recorded as resolved, and no file where there was none', async () => {
        diverged({ 'gone.md': 'base\n' }, { 'gone.md': null }, { 'gone.md': 'theirs\n' });
        rmSync(join(work, 'gone.md'));
        const stages = staged('gone.md');
        const local = new LocalGit(new GitRunner());
        const checked = local.checked.bind(local);
        // git records the resolution, then the command is reported as failed.
        vi.spyOn(local, 'checked').mockImplementation(
          async (cwd: string, args: string[], options?: LocalRunOptions) => {
            const output = await checked(cwd, args, options);
            if (args.includes('add')) {
              throw new GitOperationError('timeout', 'too slow');
            }
            return output;
          }
        );
        const merging = new GitMerge(local, { gitTimeoutMs: 60_000 } as GitOptions);

        await expect(merging.resolve(work, await entryOf('gone.md'), 'keep')).rejects.toMatchObject({
          code: 'timeout'
        });

        expect(existsSync(join(work, 'gone.md'))).toBe(false);
        expect(staged('gone.md')).toBe(stages);
        expect(await entryOf('gone.md')).toMatchObject({ resolved: false });
      });

      it('clears what a stopped backend left before it starts', async () => {
        bothChanged();
        writeFileSync(backup(), 'left over\n');

        await resolve('edited.md', 'theirs');

        expect(existsSync(backup())).toBe(false);
        expect(onDisk('edited.md')).toBe('theirs\n');
      });
    });

    it('refuses a path that is a folder on disk, and changes nothing', async () => {
      diverged({ 'gone.md': 'base\n' }, { 'gone.md': 'mine\n' }, { 'gone.md': null });
      rmSync(join(work, 'gone.md'));
      mkdirSync(join(work, 'gone.md'));
      writeFileSync(join(work, 'gone.md', 'inside.md'), 'kept\n');

      await expect(resolve('gone.md', 'delete')).rejects.toThrow('Not a file');

      expect(onDisk('gone.md/inside.md')).toBe('kept\n');
      expect(await entryOf('gone.md')).toMatchObject({ resolved: false });
    });

    it('reads one conflict without the others, and not what is inside a folder of its name', async () => {
      diverged(
        { 'docs/a.md': 'base\n', 'b.md': 'base\n' },
        { 'docs/a.md': 'mine\n', 'b.md': 'mine\n' },
        { 'docs/a.md': 'theirs\n', 'b.md': 'theirs\n' }
      );
      await resolve('docs/a.md', 'ours');

      expect(await merge.conflict(work, 'docs/a.md')).toEqual(await entryOf('docs/a.md'));
      expect(await merge.conflict(work, 'b.md')).toEqual(await entryOf('b.md'));
      expect(await merge.conflict(work, 'docs')).toBeNull();
      expect(await merge.conflict(work, 'first.md')).toBeNull();
      expect(await merge.conflict(work, '*.md')).toBeNull();
    });

    it('refuses to delete a file through a symbolic link', async () => {
      diverged({ 'docs/gone.md': 'base\n' }, { 'docs/gone.md': 'mine\n' }, { 'docs/gone.md': null });
      const outside = join(root, 'outside');
      mkdirSync(outside);
      writeFileSync(join(outside, 'gone.md'), 'not ours\n');
      rmSync(join(work, 'docs'), { recursive: true });
      symlinkSync(outside, join(work, 'docs'));

      await expect(resolve('docs/gone.md', 'delete')).rejects.toBeInstanceOf(PathRefusedError);

      expect(readFileSync(join(outside, 'gone.md'), 'utf8')).toBe('not ours\n');
      expect(await entryOf('docs/gone.md')).toMatchObject({ resolved: false });
    });

    describe('startOver', () => {
      const labels = { ours: 'main', theirs: 'theirs' };
      const startOver = async (path: string, merging = merge) => merging.startOver(work, await entryOf(path), labels);
      const unmergedStages = (path: string) =>
        git(work, 'ls-files', '-u', '--', path).split('\n').map(line => line.split('\t')[0]?.at(-1));

      it('brings back the markers and marks the file unresolved', async () => {
        bothChanged();
        await resolve('edited.md', 'ours');

        await startOver('edited.md');

        expect(onDisk('edited.md')).toBe('<<<<<<< main\nmine\n=======\ntheirs\n>>>>>>> theirs\n');
        expect(unmergedStages('edited.md')).toEqual([ '1', '2', '3' ]);
        expect(await entryOf('edited.md')).toMatchObject({ kind: 'both-changed', resolved: false, edited: false });
      });

      it('writes the same markers as the merge', async () => {
        git(work, 'config', 'merge.conflictStyle', 'zdiff3');
        diverged(
          { 'edited.md': 'one\ntwo\nthree\n' },
          { 'edited.md': 'one\nmine\nthree\n' },
          { 'edited.md': 'one\ntheirs\nthree\n' }
        );
        await merge.writeMarkers(work, 'edited.md', labels);
        const asMerged = onDisk('edited.md');
        writeFileSync(join(work, 'edited.md'), 'one\nboth\nthree\n');
        await resolve('edited.md', 'mark-resolved');

        await startOver('edited.md');

        expect(onDisk('edited.md')).toBe(asMerged);
        expect(asMerged).toBe('one\n<<<<<<< main\nmine\n=======\ntheirs\n>>>>>>> theirs\nthree\n');
      });

      it('brings back a file that was deleted', async () => {
        diverged({ 'gone.md': 'base\n' }, { 'gone.md': 'mine\n' }, { 'gone.md': null });
        await resolve('gone.md', 'delete');

        await startOver('gone.md');

        expect(onDisk('gone.md')).toBe('mine\n');
        expect(unmergedStages('gone.md')).toEqual([ '1', '2' ]);
        expect(await entryOf('gone.md')).toMatchObject({ kind: 'deleted-by-them', resolved: false });
      });

      it('brings back my version of a binary file', async () => {
        const mine = Buffer.from([ 0, 1, 2, 0xff ]);
        diverged({ 'image.png': Buffer.from([ 0, 0 ]) }, { 'image.png': mine }, { 'image.png': Buffer.from([ 0, 9 ]) });
        await resolve('image.png', 'theirs');

        await startOver('image.png');

        expect(readFileSync(join(work, 'image.png')).equals(mine)).toBe(true);
        expect(await entryOf('image.png')).toMatchObject({ resolved: false });
      });

      it('gives my version of a file that does not decode', async () => {
        const mine = Buffer.from([ 0x61, 0xff, 0x0a ]);
        diverged(
          { 'edited.md': 'base\n' },
          { 'edited.md': mine },
          { 'edited.md': Buffer.from([ 0x62, 0xfe, 0x0a ]) }
        );
        await resolve('edited.md', 'theirs');

        await startOver('edited.md');

        expect(readFileSync(join(work, 'edited.md')).equals(mine)).toBe(true);
        expect(await entryOf('edited.md')).toMatchObject({ resolved: false });
      });

      it('brings back their version of a file I deleted', async () => {
        diverged({ 'gone.md': 'base\n' }, { 'gone.md': null }, { 'gone.md': 'theirs\n' });
        await resolve('gone.md', 'delete');

        await startOver('gone.md');

        expect(onDisk('gone.md')).toBe('theirs\n');
        expect(await entryOf('gone.md')).toMatchObject({ kind: 'deleted-by-us', resolved: false });
      });

      it('says when the user edited it', async () => {
        bothChanged();
        writeFileSync(join(work, 'edited.md'), 'both, by hand\n');

        await resolve('edited.md', 'mark-resolved');

        expect(await entryOf('edited.md')).toMatchObject({
          resolved: true,
          edited: true,
          resolution: { mode: '100644', oid: git(work, 'rev-parse', ':0:edited.md') }
        });
      });

      it('says nothing for a whole version', async () => {
        diverged(
          { 'a.md': 'base\n', 'b.md': 'base\n', 'c.md': 'base\n', 'gone.md': 'base\n' },
          { 'a.md': 'mine\n', 'b.md': 'mine\n', 'c.md': 'mine\n', 'gone.md': 'mine\n' },
          { 'a.md': 'theirs\n', 'b.md': 'theirs\n', 'c.md': 'theirs\n', 'gone.md': null }
        );

        await resolve('a.md', 'ours');
        await resolve('b.md', 'theirs');
        await resolve('gone.md', 'delete');

        expect((await merge.conflicts(work)).map(({ path, edited }) => [ path, edited ])).toEqual([
          [ 'a.md', false ],
          [ 'b.md', false ],
          [ 'c.md', false ],
          [ 'gone.md', false ]
        ]);
      });

      it('asks when in doubt', async () => {
        diverged({ 'edited.md': 'base\r\n' }, { 'edited.md': 'mine\r\n' }, { 'edited.md': 'theirs\r\n' });
        // Line endings are normalised when the version is added, so the blob is not mine any more.
        writeFileSync(join(work, '.gitattributes'), '*.md text\n');

        await resolve('edited.md', 'ours');

        expect(await entryOf('edited.md')).toMatchObject({ resolved: true, edited: true });
      });

      it('leaves the other files alone', async () => {
        diverged(
          { 'a.md': 'base\n', 'b.md': 'base\n', 'c.md': 'base\n' },
          { 'a.md': 'mine\n', 'b.md': 'mine\n', 'c.md': 'mine\n' },
          { 'a.md': 'theirs\n', 'b.md': 'theirs\n', 'c.md': 'theirs\n' }
        );
        await resolve('a.md', 'theirs');
        writeFileSync(join(work, 'b.md'), 'by hand\n');
        await resolve('b.md', 'mark-resolved');
        writeFileSync(join(work, 'c.md'), 'saved\n');
        const before = { b: staged('b.md'), c: staged('c.md') };

        await startOver('a.md');

        expect(onDisk('b.md')).toBe('by hand\n');
        expect(onDisk('c.md')).toBe('saved\n');
        expect({ b: staged('b.md'), c: staged('c.md') }).toEqual(before);
        expect(await merge.conflicts(work)).toMatchObject([
          { path: 'a.md', resolved: false },
          { path: 'b.md', resolved: true, edited: true },
          { path: 'c.md', resolved: false }
        ]);
      });

      it('starts over a file with a name like a pathspec, and nothing it would match', async () => {
        const files = (content: string) => ({ ':(top)x.md': content, 'x.md': content });
        diverged(files('base\n'), files('mine\n'), files('theirs\n'));
        await resolve(':(top)x.md', 'theirs');
        await resolve('x.md', 'ours');

        await startOver(':(top)x.md');

        expect(onDisk(':(top)x.md')).toContain('<<<<<<< main');
        expect(onDisk('x.md')).toBe('mine\n');
        expect(await entryOf('x.md')).toMatchObject({ resolved: true });
      });

      it.each([ 'checkout', '--unresolve' ])(
        'puts the file and its resolution back when git fails at %s',
        async step => {
          bothChanged();
          writeFileSync(join(work, 'edited.md'), 'by hand\n');
          await resolve('edited.md', 'mark-resolved');
          const before = { index: staged('edited.md'), undo: git(work, 'ls-files', '--resolve-undo') };

          await expect(startOver('edited.md', failing(step))).rejects.toMatchObject({ code: 'timeout' });

          expect(onDisk('edited.md')).toBe('by hand\n');
          expect({ index: staged('edited.md'), undo: git(work, 'ls-files', '--resolve-undo') }).toEqual(before);
          expect(existsSync(backup())).toBe(false);
        }
      );

      it('puts a deletion back when git fails', async () => {
        diverged({ 'gone.md': 'base\n' }, { 'gone.md': 'mine\n' }, { 'gone.md': null });
        await resolve('gone.md', 'delete');

        await expect(startOver('gone.md', failing('checkout'))).rejects.toMatchObject({ code: 'timeout' });

        expect(existsSync(join(work, 'gone.md'))).toBe(false);
        expect(staged('gone.md')).toBe('');
        expect(await entryOf('gone.md')).toMatchObject({ resolved: true });
      });

      it('refuses a file through a symbolic link, and changes nothing', async () => {
        diverged({ 'docs/a.md': 'base\n' }, { 'docs/a.md': 'mine\n' }, { 'docs/a.md': 'theirs\n' });
        await resolve('docs/a.md', 'ours');
        const outside = join(root, 'outside');
        mkdirSync(outside);
        writeFileSync(join(outside, 'a.md'), 'not ours\n');
        rmSync(join(work, 'docs'), { recursive: true });
        symlinkSync(outside, join(work, 'docs'));

        await expect(startOver('docs/a.md')).rejects.toBeInstanceOf(PathRefusedError);

        expect(readFileSync(join(outside, 'a.md'), 'utf8')).toBe('not ours\n');
        expect(await entryOf('docs/a.md')).toMatchObject({ resolved: true });
      });
    });
  });
});
