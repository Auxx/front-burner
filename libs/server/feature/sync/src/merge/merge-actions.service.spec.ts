import { Database } from '@front-burner/server-core-database';
import type { EventsHub } from '@front-burner/server-core-events';
import {
  GitEngine,
  GitMerge,
  GitOperationError,
  GitRunner,
  LocalGit,
  NetworkLock,
  WorkingTreeLock
} from '@front-burner/server-core-git';
import { ApiErrorException } from '@front-burner/server-core-observability';
import type { DataLayout } from '@front-burner/server-core-storage';
import { FileContents, type OpenableRepository, WorkingTreeGuard } from '@front-burner/server-feature-files';
import type { CommitAuthors } from '@front-burner/server-feature-preferences';
import { EDITABLE_FILE_LIMIT, type PushEvent } from '@front-burner/shared-contracts';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { MergeRecord } from '../state/merge-record';
import { SyncStateStore } from '../state/sync-state.store';
import { insertRepository, insertUser } from '../testing/fixtures';
import { createRemote, git, testGitOptions } from '../testing/git-fixtures';
import { createTestDatabase } from '../testing/test-database';
import { MergeActions } from './merge-actions.service';
import { MergeGuard } from './merge-guard';
import { MergeStateService } from './merge-state.service';

const AUTHOR = { name: 'Ada Lovelace', email: 'ada@example.com' };
const REF = 'refs/front-burner/pre-merge';

type Files = Record<string, string | null>;

// Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
describe.skipIf(process.platform === 'win32')('MergeActions', () => {
  const options = testGitOptions();
  const runner = new GitRunner();
  const engine = new GitEngine(options, runner);
  const merges = new GitMerge(new LocalGit(runner), options);
  const contents = new FileContents(
    {} as OpenableRepository,
    {} as WorkingTreeGuard,
    engine,
    {} as EventsHub,
    {} as DataLayout
  );
  let database: Database;
  let syncState: SyncStateStore;
  let lock: WorkingTreeLock;
  let actions: MergeActions;
  let published: PushEvent[];
  let userId: number;
  let repositoryId: number;
  let root: string;
  let work: string;
  let elsewhere: string;
  let authorConfirmed: boolean;

  function put(folder: string, files: Files): void {
    for (const [ path, content ] of Object.entries(files)) {
      const absolute = join(folder, path);
      rmSync(absolute, { force: true });
      if (content !== null) {
        mkdirSync(dirname(absolute), { recursive: true });
        writeFileSync(absolute, content);
      }
    }
    git(folder, 'add', '-A');
    git(folder, 'commit', '-q', '--allow-empty', '-m', 'files');
  }

  /** Commits `base` on both sides, then `theirs` on the remote and `mine` here, and fetches. */
  function diverged(base: Files, mine: Files, theirs: Files): void {
    put(work, base);
    git(work, 'push', '-q', 'origin', 'main');
    git(elsewhere, 'pull', '-q', 'origin', 'main');
    put(elsewhere, theirs);
    git(elsewhere, 'push', '-q', 'origin', 'main');
    put(work, mine);
    git(work, 'fetch', '-q', 'origin');
  }

  async function mergeThatConflicts(): Promise<void> {
    const result = await merges.merge(work, { branch: 'main', upstream: 'origin/main', author: AUTHOR });
    expect(result.kind).toBe('conflicted');
  }

  /** What a pull does around the merge: the record, and a merge that waits for the user. */
  async function pullThatConflicts(): Promise<string> {
    const recorded = await merges.record(work);
    syncState.startMerge(repositoryId, recorded);
    await mergeThatConflicts();
    syncState.mergeStopped(repositoryId);
    return recorded;
  }

  /** Everything that "exactly as before" covers: the branch, the index and each file on disk. */
  function snapshot() {
    const files = readdirSync(work, { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile() && !relative(work, entry.parentPath).split('/').includes('.git'))
      .map(entry => join(entry.parentPath, entry.name));
    return {
      head: git(work, 'rev-parse', 'HEAD'),
      status: git(work, 'status', '--porcelain', '--branch'),
      index: git(work, 'ls-files', '--stage'),
      resolveUndo: git(work, 'ls-files', '--resolve-undo'),
      files: Object.fromEntries(files.sort().map(path => [ relative(work, path), readFileSync(path, 'utf8') ]))
    };
  }

  const mergeFiles = () =>
    [ 'MERGE_HEAD', 'MERGE_MSG', 'MERGE_MODE' ].filter(file => existsSync(join(work, '.git', file)));
  const refAt = () => {
    try {
      return git(work, 'rev-parse', '-q', '--verify', REF).trim();
    } catch {
      return null;
    }
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'merge-actions-'));
    const bare = createRemote(root);
    work = join(root, 'work');
    elsewhere = join(root, 'elsewhere');
    git(root, 'clone', '-q', bare, work);
    git(root, 'clone', '-q', bare, elsewhere);
    database = createTestDatabase();
    syncState = new SyncStateStore(database);
    userId = insertUser(database, 'a@example.com');
    repositoryId = insertRepository(database, userId, { name: 'notes' });
    published = [];
    authorConfirmed = true;
    lock = new WorkingTreeLock();
    actions = new MergeActions(
      {
        root: (user: number, id: number) => {
          if (user !== userId || id !== repositoryId) {
            throw new ApiErrorException(404, 'not-found');
          }
          return work;
        }
      } as unknown as OpenableRepository,
      new MergeGuard(lock, merges),
      merges,
      syncState,
      new MergeRecord(syncState, merges),
      { publish: (_user: number, event: PushEvent) => published.push(event) } as unknown as EventsHub,
      new MergeStateService(merges, contents),
      contents,
      {
        forRepository: () => ({ author: AUTHOR, source: 'default', confirmed: authorConfirmed })
      } as unknown as CommitAuthors,
      engine,
      new WorkingTreeGuard(lock, engine, merges),
      new NetworkLock()
    );
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(root, { recursive: true, force: true });
  });

  describe('abort', () => {
    const conflicting = () =>
      diverged(
        { 'edited.md': 'base\n', 'resolved.md': 'base\n', 'clean.md': 'one\ntwo\nthree\n' },
        { 'edited.md': 'mine\n', 'resolved.md': 'mine\n', 'clean.md': 'ONE\ntwo\nthree\n' },
        { 'edited.md': 'theirs\n', 'resolved.md': 'theirs\n', 'clean.md': 'one\ntwo\nTHREE\n' }
      );

    it('puts everything back after edits and resolutions', async () => {
      conflicting();
      const before = snapshot();
      await pullThatConflicts();
      writeFileSync(join(work, 'edited.md'), 'a saved edit\n');
      writeFileSync(join(work, 'resolved.md'), 'resolved by hand\n');
      git(work, 'add', 'resolved.md');
      writeFileSync(join(work, 'resolved.md'), 'edited again after resolving\n');
      expect(git(work, 'ls-files', '--resolve-undo')).not.toBe('');

      await actions.abort(userId, repositoryId);

      expect(snapshot()).toEqual(before);
      expect(mergeFiles()).toEqual([]);
    });

    it('removes what the merge added', async () => {
      diverged(
        { 'both.md': 'base\n', 'gone.md': 'base\n' },
        { 'both.md': 'mine\n', 'gone.md': null },
        { 'both.md': 'theirs\n', 'gone.md': 'changed\n', 'new/folder/added.md': 'added\n', 'both-added.md': 'theirs\n' }
      );
      const before = snapshot();
      await pullThatConflicts();
      expect(existsSync(join(work, 'new/folder/added.md'))).toBe(true);
      expect(existsSync(join(work, 'gone.md'))).toBe(true);

      await actions.abort(userId, repositoryId);

      expect(snapshot()).toEqual(before);
      expect(existsSync(join(work, 'new'))).toBe(false);
      expect(existsSync(join(work, 'gone.md'))).toBe(false);
    });

    it('keeps a file that git ignores', async () => {
      diverged({ '.gitignore': '*.log\n', 'both.md': 'base\n' }, { 'both.md': 'mine\n' }, { 'both.md': 'theirs\n' });
      writeFileSync(join(work, 'kept.log'), 'mine alone\n');
      await pullThatConflicts();

      await actions.abort(userId, repositoryId);

      expect(readFileSync(join(work, 'kept.log'), 'utf8')).toBe('mine alone\n');
    });

    it('forgets the record', async () => {
      conflicting();
      await pullThatConflicts();

      await actions.abort(userId, repositoryId);

      expect(syncState.record(repositoryId)).toEqual({ recordedCommit: null, mergeCommit: null, applying: false });
      expect(refAt()).toBeNull();
    });

    it('gives back the record of an earlier merge', async () => {
      put(work, { 'earlier.md': 'earlier\n' });
      const earlier = await merges.record(work);
      syncState.startMerge(repositoryId, earlier);
      put(work, { 'merged.md': 'stands for an earlier merge commit\n' });
      const mergeCommit = git(work, 'rev-parse', 'HEAD').trim();
      syncState.mergeCommitted(repositoryId, mergeCommit);
      conflicting();
      await pullThatConflicts();

      await actions.abort(userId, repositoryId);

      expect(syncState.record(repositoryId)).toEqual({ recordedCommit: earlier, mergeCommit, applying: false });
      expect(refAt()).toBe(earlier);
    });

    it('a late save from elsewhere is a change, and no merge', async () => {
      conflicting();
      await pullThatConflicts();
      await actions.abort(userId, repositoryId);

      // What a save from another device does, once the guard lets it through.
      writeFileSync(join(work, 'edited.md'), 'typed on the other device\n');

      expect(await merges.mergeInProgress(work)).toBe(false);
      expect((await engine.status(work)).changes).toEqual([ { path: 'edited.md', state: 'modified' } ]);
    });

    it('shows the upstream\'s commits as to pull again', async () => {
      conflicting();
      await pullThatConflicts();

      await actions.abort(userId, repositoryId);

      expect(await engine.status(work)).toMatchObject({ ahead: 1, behind: 1, changes: [] });
    });

    it('goes back to the ref when the database has lost the record', async () => {
      conflicting();
      const before = snapshot();
      await merges.record(work);
      await mergeThatConflicts();
      writeFileSync(join(work, 'edited.md'), 'a saved edit\n');

      await actions.abort(userId, repositoryId);

      expect(snapshot()).toEqual(before);
      expect(refAt()).toBeNull();
    });

    it('aborts with git\'s own abort when no record is left', async () => {
      conflicting();
      const before = snapshot();
      const abort = vi.spyOn(merges, 'abort');
      await mergeThatConflicts();

      await actions.abort(userId, repositoryId);

      expect(abort).toHaveBeenCalledOnce();
      expect(snapshot()).toEqual(before);
    });

    // A restored database, or a merge that git started without a pull: going back
    // to such a commit would take the user's later commits off the branch.
    it('never goes back to a record that is not the commit the merge started from', async () => {
      put(work, { 'older.md': 'older\n' });
      const older = await merges.record(work);
      syncState.startMerge(repositoryId, older);
      syncState.mergeCommitted(repositoryId, older);
      conflicting();
      const before = snapshot();
      await mergeThatConflicts();

      await actions.abort(userId, repositoryId);

      expect(snapshot()).toEqual(before);
      expect(syncState.record(repositoryId)).toMatchObject({ recordedCommit: older });
      expect(refAt()).toBe(older);
    });

    // A pull's merge waits with no merge commit: this record is of a merge that is over.
    it('never goes back to the record of a committed merge, even when it is HEAD', async () => {
      diverged({ 'both.md': 'base\n', 'other.md': 'base\n' }, { 'both.md': 'mine\n' }, { 'both.md': 'theirs\n' });
      const recorded = await merges.record(work);
      syncState.startMerge(repositoryId, recorded);
      syncState.mergeCommitted(repositoryId, 'the-merge-commit');
      writeFileSync(join(work, 'other.md'), 'not committed\n');
      await mergeThatConflicts();

      await actions.abort(userId, repositoryId);

      expect(await merges.mergeInProgress(work)).toBe(false);
      expect(readFileSync(join(work, 'other.md'), 'utf8')).toBe('not committed\n');
      expect(syncState.record(repositoryId)).toMatchObject({
        recordedCommit: recorded,
        mergeCommit: 'the-merge-commit'
      });
      expect(refAt()).toBe(recorded);
    });

    it('ends a merge with no record even when git refuses to abort it', async () => {
      conflicting();
      const before = snapshot();
      await mergeThatConflicts();
      writeFileSync(join(work, 'resolved.md'), 'resolved by hand\n');
      git(work, 'add', 'resolved.md');
      writeFileSync(join(work, 'resolved.md'), 'edited again after resolving\n');

      await actions.abort(userId, repositoryId);

      expect(snapshot()).toEqual(before);
      expect(mergeFiles()).toEqual([]);
    });

    it('says with a code that git failed, and keeps the merge and its record', async () => {
      conflicting();
      const recorded = await pullThatConflicts();
      vi.spyOn(merges, 'resetTo').mockRejectedValueOnce(new Error('disk full'));

      await expect(actions.abort(userId, repositoryId)).rejects.toMatchObject({
        status: 500,
        code: 'merge-abort-failed'
      });

      expect(await merges.mergeInProgress(work)).toBe(true);
      expect(syncState.record(repositoryId)).toMatchObject({ recordedCommit: recorded });
      expect(refAt()).toBe(recorded);
    });

    it('a second abort is refused', async () => {
      conflicting();
      await pullThatConflicts();

      const results = await Promise.allSettled([
        actions.abort(userId, repositoryId),
        actions.abort(userId, repositoryId)
      ]);

      expect(results[0].status).toBe('fulfilled');
      expect(results[1]).toMatchObject({ status: 'rejected', reason: { status: 409, code: 'no-merge-in-progress' } });
      expect(published).toHaveLength(2);
    });

    it('refuses a rebase, which is not a merge', async () => {
      conflicting();
      expect(() => git(work, 'rebase', 'origin/main')).toThrow();

      await expect(actions.abort(userId, repositoryId)).rejects.toMatchObject({ code: 'no-merge-in-progress' });

      expect(existsSync(join(work, '.git', 'rebase-merge'))).toBe(true);
    });

    it('runs inside the lock', async () => {
      conflicting();
      await pullThatConflicts();
      const { promise: gate, resolve: release } = Promise.withResolvers<void>();
      const held = lock.run(repositoryId, () => gate);

      const abort = actions.abort(userId, repositoryId);
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(await merges.mergeInProgress(work)).toBe(true);

      release();
      await Promise.all([ held, abort ]);
      expect(await merges.mergeInProgress(work)).toBe(false);
    });

    it('publishes files.changed and git.changed', async () => {
      conflicting();
      await pullThatConflicts();

      await actions.abort(userId, repositoryId);

      expect(published).toEqual([
        { type: 'files.changed', repositoryId, folders: 'all' },
        { type: 'git.changed', repositoryId }
      ]);
    });

    it('publishes nothing when there is no merge', async () => {
      await expect(actions.abort(userId, repositoryId)).rejects.toMatchObject({ code: 'no-merge-in-progress' });

      expect(published).toEqual([]);
    });

    it('a failed abort keeps the merge and its record, and clients are told', async () => {
      conflicting();
      const recorded = await pullThatConflicts();
      vi.spyOn(merges, 'resetTo').mockRejectedValueOnce(new GitOperationError('timeout', 'too slow'));

      await expect(actions.abort(userId, repositoryId)).rejects.toMatchObject({ status: 504, code: 'git-timeout' });

      expect(await merges.mergeInProgress(work)).toBe(true);
      expect(syncState.record(repositoryId)).toMatchObject({ recordedCommit: recorded });
      expect(refAt()).toBe(recorded);
      // A reset that ran out of time can have changed files.
      expect(published.map(({ type }) => type)).toEqual([ 'files.changed', 'git.changed' ]);
    });

    it('answers another user\'s repository like a missing one', async () => {
      conflicting();
      await pullThatConflicts();

      await expect(actions.abort(userId + 1, repositoryId)).rejects.toMatchObject({ status: 404, code: 'not-found' });

      expect(await merges.mergeInProgress(work)).toBe(true);
    });
  });

  describe('resolve', () => {
    const conflicting = () =>
      diverged(
        {
          'edited.md': 'base\n',
          'other.md': 'base\n',
          'docs/inner.md': 'base\n',
          'data.txt': 'base\n',
          'gone.md': 'base\n'
        },
        {
          'edited.md': 'mine\n',
          'other.md': 'mine\n',
          'docs/inner.md': 'mine\n',
          'data.txt': 'mine\n',
          'gone.md': 'mine\n'
        },
        {
          'edited.md': 'theirs\n',
          'other.md': 'theirs\n',
          'docs/inner.md': 'theirs\n',
          'data.txt': 'theirs\n',
          'gone.md': null
        }
      );
    const resolved = async (path: string) =>
      (await merges.conflicts(work)).find(conflict => conflict.path === path)?.resolved;
    const onDisk = (path: string) => readFileSync(join(work, path), 'utf8');

    it('marks a file as resolved with its saved content', async () => {
      conflicting();
      await pullThatConflicts();
      writeFileSync(join(work, 'edited.md'), 'mine and theirs\n');

      await actions.resolve(userId, repositoryId, { path: 'edited.md', resolution: 'mark-resolved' });

      expect(await resolved('edited.md')).toBe(true);
      expect(git(work, 'show', ':0:edited.md')).toBe('mine and theirs\n');
    });

    it('refuses leftover markers without force, and goes ahead with it', async () => {
      conflicting();
      await pullThatConflicts();
      const request = { path: 'edited.md', resolution: 'mark-resolved' } as const;

      await expect(actions.resolve(userId, repositoryId, request))
        .rejects.toMatchObject({ status: 409, code: 'conflict-markers-left' });
      expect(await resolved('edited.md')).toBe(false);
      expect(published).toEqual([]);

      await actions.resolve(userId, repositoryId, { ...request, force: true });
      expect(await resolved('edited.md')).toBe(true);
      expect(git(work, 'show', ':0:edited.md')).toContain('<<<<<<< main');
    });

    it('uses my version or theirs, and keeps or deletes a file one side deleted', async () => {
      conflicting();
      await pullThatConflicts();

      await actions.resolve(userId, repositoryId, { path: 'edited.md', resolution: 'ours' });
      await actions.resolve(userId, repositoryId, { path: 'data.txt', resolution: 'theirs' });
      await actions.resolve(userId, repositoryId, { path: 'gone.md', resolution: 'delete' });

      expect(onDisk('edited.md')).toBe('mine\n');
      expect(onDisk('data.txt')).toBe('theirs\n');
      expect(existsSync(join(work, 'gone.md'))).toBe(false);
      expect(await merges.conflicts(work)).toMatchObject([
        { path: 'data.txt', resolved: true },
        { path: 'docs/inner.md', resolved: false },
        { path: 'edited.md', resolved: true },
        { path: 'gone.md', kind: 'deleted-by-them', resolved: true },
        { path: 'other.md', resolved: false }
      ]);
    });

    it('refuses a path through a symbolic link', async () => {
      conflicting();
      await pullThatConflicts();
      const outside = join(root, 'outside');
      mkdirSync(outside);
      writeFileSync(join(outside, 'inner.md'), 'not in the working copy\n');
      rmSync(join(work, 'docs'), { recursive: true });
      symlinkSync(outside, join(work, 'docs'));

      for (const resolution of [ 'mark-resolved', 'ours' ] as const) {
        await expect(actions.resolve(userId, repositoryId, { path: 'docs/inner.md', resolution, force: true }))
          .rejects.toMatchObject({ status: 400, code: 'path-refused', params: { reason: 'symlink' } });
      }

      expect(readFileSync(join(outside, 'inner.md'), 'utf8')).toBe('not in the working copy\n');
      expect(await resolved('docs/inner.md')).toBe(false);
      expect(published).toEqual([]);
    });

    it('refuses a resolution the kind does not allow', async () => {
      conflicting();
      await pullThatConflicts();
      const refusals = [
        { path: 'edited.md', resolution: 'keep' },
        { path: 'edited.md', resolution: 'delete' },
        { path: 'gone.md', resolution: 'ours' },
        { path: 'gone.md', resolution: 'theirs' },
        { path: 'gone.md', resolution: 'mark-resolved' }
      ] as const;

      for (const request of refusals) {
        await expect(actions.resolve(userId, repositoryId, request))
          .rejects.toMatchObject({ status: 409, code: 'resolution-not-allowed' });
      }

      expect(await resolved('edited.md')).toBe(false);
      expect(await resolved('gone.md')).toBe(false);
      expect(onDisk('gone.md')).toBe('mine\n');
    });

    it('refuses mark-resolved for a file that is not editable', async () => {
      conflicting();
      await pullThatConflicts();

      await expect(
        actions.resolve(userId, repositoryId, { path: 'data.txt', resolution: 'mark-resolved', force: true })
      ).rejects.toMatchObject({ status: 409, code: 'resolution-not-allowed' });

      expect(await resolved('data.txt')).toBe(false);
    });

    it('says why a file that the editor can\'t open now can\'t be marked as resolved', async () => {
      conflicting();
      await pullThatConflicts();
      const mark = { path: 'edited.md', resolution: 'mark-resolved', force: true } as const;

      writeFileSync(join(work, 'edited.md'), 'x'.repeat(EDITABLE_FILE_LIMIT + 1));
      await expect(actions.resolve(userId, repositoryId, mark))
        .rejects.toMatchObject({ status: 413, code: 'file-too-large' });
      writeFileSync(join(work, 'edited.md'), Buffer.from([ 0x61, 0xff, 0x0a ]));
      await expect(actions.resolve(userId, repositoryId, mark))
        .rejects.toMatchObject({ status: 422, code: 'file-not-utf8' });
      rmSync(join(work, 'edited.md'));
      await expect(actions.resolve(userId, repositoryId, mark))
        .rejects.toMatchObject({ status: 404, code: 'entry-not-found' });

      expect(await resolved('edited.md')).toBe(false);
      expect(published).toEqual([]);
    });

    it('refuses a file that is a folder on disk now, and changes nothing', async () => {
      conflicting();
      await pullThatConflicts();
      rmSync(join(work, 'gone.md'));
      mkdirSync(join(work, 'gone.md'));
      writeFileSync(join(work, 'gone.md', 'inside.md'), 'kept\n');

      for (const resolution of [ 'delete', 'keep' ] as const) {
        await expect(actions.resolve(userId, repositoryId, { path: 'gone.md', resolution }))
          .rejects.toMatchObject({ status: 409, code: 'resolution-not-allowed' });
      }

      expect(onDisk('gone.md/inside.md')).toBe('kept\n');
      expect(await resolved('gone.md')).toBe(false);
      expect(published).toEqual([]);
    });

    it('refuses a file already resolved, or not in the merge', async () => {
      conflicting();
      await pullThatConflicts();
      await actions.resolve(userId, repositoryId, { path: 'edited.md', resolution: 'theirs' });

      for (const path of [ 'edited.md', 'missing.md' ]) {
        await expect(actions.resolve(userId, repositoryId, { path, resolution: 'ours' }))
          .rejects.toMatchObject({ status: 409, code: 'not-conflicting' });
      }
      expect(onDisk('edited.md')).toBe('theirs\n');
    });

    it('refuses when there is no merge', async () => {
      await expect(actions.resolve(userId, repositoryId, { path: 'edited.md', resolution: 'ours' }))
        .rejects.toMatchObject({ status: 409, code: 'no-merge-in-progress' });
    });

    it('leaves the other files alone', async () => {
      conflicting();
      await pullThatConflicts();
      writeFileSync(join(work, 'other.md'), 'saved\n');

      await actions.resolve(userId, repositoryId, { path: 'edited.md', resolution: 'theirs' });

      expect(onDisk('other.md')).toBe('saved\n');
      expect(await resolved('other.md')).toBe(false);
      expect(onDisk('docs/inner.md')).toContain('<<<<<<< main');
    });

    it('waits for a save in progress', async () => {
      conflicting();
      await pullThatConflicts();
      const { promise: gate, resolve: release } = Promise.withResolvers<void>();
      const held = lock.run(repositoryId, () => gate);

      const resolving = actions.resolve(userId, repositoryId, { path: 'edited.md', resolution: 'ours' });
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(await resolved('edited.md')).toBe(false);

      release();
      await Promise.all([ held, resolving ]);
      expect(await resolved('edited.md')).toBe(true);
    });

    it('publishes files.changed and git.changed', async () => {
      conflicting();
      await pullThatConflicts();

      await actions.resolve(userId, repositoryId, { path: 'docs/inner.md', resolution: 'theirs' });
      await actions.resolve(userId, repositoryId, { path: 'edited.md', resolution: 'theirs' });

      expect(published).toEqual([
        { type: 'files.changed', repositoryId, folders: [ 'docs' ] },
        { type: 'git.changed', repositoryId },
        { type: 'files.changed', repositoryId, folders: [ '' ] },
        { type: 'git.changed', repositoryId }
      ]);
    });

    it('says with a code that git failed, and clients are told', async () => {
      conflicting();
      await pullThatConflicts();
      vi.spyOn(merges, 'resolve').mockRejectedValueOnce(new GitOperationError('timeout', 'too slow'));

      await expect(actions.resolve(userId, repositoryId, { path: 'edited.md', resolution: 'ours' }))
        .rejects.toMatchObject({ status: 504, code: 'git-timeout' });

      expect(await merges.mergeInProgress(work)).toBe(true);
      expect(published.map(({ type }) => type)).toEqual([ 'files.changed', 'git.changed' ]);
    });

    describe('startOver', () => {
      const entry = async (path: string) => (await merges.conflicts(work)).find(conflict => conflict.path === path);

      it('brings back the markers with the branch names and marks the file unresolved', async () => {
        conflicting();
        await pullThatConflicts();
        const asMerged = onDisk('edited.md');
        writeFileSync(join(work, 'edited.md'), 'mine and theirs\n');
        await actions.resolve(userId, repositoryId, { path: 'edited.md', resolution: 'mark-resolved' });
        expect(await entry('edited.md')).toMatchObject({ resolved: true, edited: true });

        await actions.startOver(userId, repositoryId, 'edited.md');

        expect(onDisk('edited.md')).toBe(asMerged);
        expect(asMerged).toBe('<<<<<<< main\nmine\n=======\ntheirs\n>>>>>>> origin/main\n');
        expect(await entry('edited.md')).toMatchObject({ resolved: false, edited: false });
      });

      it('brings back a file that was deleted', async () => {
        conflicting();
        await pullThatConflicts();
        await actions.resolve(userId, repositoryId, { path: 'gone.md', resolution: 'delete' });

        await actions.startOver(userId, repositoryId, 'gone.md');

        expect(onDisk('gone.md')).toBe('mine\n');
        expect(await resolved('gone.md')).toBe(false);
      });

      it('refuses a file that is not resolved', async () => {
        conflicting();
        await pullThatConflicts();
        writeFileSync(join(work, 'edited.md'), 'saved\n');
        const before = snapshot();

        await expect(actions.startOver(userId, repositoryId, 'edited.md'))
          .rejects.toMatchObject({ status: 409, code: 'not-resolved' });

        expect(snapshot()).toEqual(before);
        expect(published).toEqual([]);
      });

      it('refuses a file not in the merge, and when there is no merge', async () => {
        await expect(actions.startOver(userId, repositoryId, 'edited.md'))
          .rejects.toMatchObject({ status: 409, code: 'no-merge-in-progress' });
        conflicting();
        await pullThatConflicts();

        for (const path of [ 'missing.md', 'docs' ]) {
          await expect(actions.startOver(userId, repositoryId, path))
            .rejects.toMatchObject({ status: 409, code: 'not-conflicting' });
        }
        expect(published).toEqual([]);
      });

      it('refuses a path through a symbolic link', async () => {
        conflicting();
        await pullThatConflicts();
        await actions.resolve(userId, repositoryId, { path: 'docs/inner.md', resolution: 'ours' });
        const outside = join(root, 'outside');
        mkdirSync(outside);
        writeFileSync(join(outside, 'inner.md'), 'not in the working copy\n');
        rmSync(join(work, 'docs'), { recursive: true });
        symlinkSync(outside, join(work, 'docs'));
        published = [];

        await expect(actions.startOver(userId, repositoryId, 'docs/inner.md'))
          .rejects.toMatchObject({ status: 400, code: 'path-refused', params: { reason: 'symlink' } });

        expect(readFileSync(join(outside, 'inner.md'), 'utf8')).toBe('not in the working copy\n');
        expect(await resolved('docs/inner.md')).toBe(true);
      });

      it('leaves the other files alone', async () => {
        conflicting();
        await pullThatConflicts();
        await actions.resolve(userId, repositoryId, { path: 'edited.md', resolution: 'theirs' });
        await actions.resolve(userId, repositoryId, { path: 'data.txt', resolution: 'ours' });
        writeFileSync(join(work, 'other.md'), 'saved\n');
        const others = () => ({
          index: git(work, 'ls-files', '--stage', '--', 'data.txt', 'other.md', 'docs', 'gone.md'),
          data: onDisk('data.txt'),
          other: onDisk('other.md'),
          inner: onDisk('docs/inner.md')
        });
        const before = others();

        await actions.startOver(userId, repositoryId, 'edited.md');

        expect(others()).toEqual(before);
        expect(await resolved('data.txt')).toBe(true);
      });

      it('publishes files.changed and git.changed', async () => {
        conflicting();
        await pullThatConflicts();
        await actions.resolve(userId, repositoryId, { path: 'docs/inner.md', resolution: 'theirs' });
        published = [];

        await actions.startOver(userId, repositoryId, 'docs/inner.md');

        expect(published).toEqual([
          { type: 'files.changed', repositoryId, folders: [ 'docs' ] },
          { type: 'git.changed', repositoryId }
        ]);
      });

      it('refuses a file that is a folder on disk now, and changes nothing', async () => {
        conflicting();
        await pullThatConflicts();
        await actions.resolve(userId, repositoryId, { path: 'gone.md', resolution: 'delete' });
        mkdirSync(join(work, 'gone.md'));
        writeFileSync(join(work, 'gone.md', 'inside.md'), 'kept\n');
        published = [];

        await expect(actions.startOver(userId, repositoryId, 'gone.md'))
          .rejects.toMatchObject({ status: 409, code: 'resolution-not-allowed' });

        expect(onDisk('gone.md/inside.md')).toBe('kept\n');
        expect(await resolved('gone.md')).toBe(true);
        expect(published).toEqual([]);
      });

      it('refuses a file whose folder is gone, so no folder comes back unannounced', async () => {
        diverged({ 'notes/deep/gone.md': 'base\n' }, { 'notes/deep/gone.md': 'mine\n' }, {
          'notes/deep/gone.md': null
        });
        await pullThatConflicts();
        await actions.resolve(userId, repositoryId, { path: 'notes/deep/gone.md', resolution: 'delete' });
        rmSync(join(work, 'notes'), { recursive: true });
        published = [];

        await expect(actions.startOver(userId, repositoryId, 'notes/deep/gone.md'))
          .rejects.toMatchObject({ status: 404, code: 'entry-not-found' });

        expect(existsSync(join(work, 'notes'))).toBe(false);
        expect(await resolved('notes/deep/gone.md')).toBe(true);
        expect(published).toEqual([]);
      });

      it('says with a code that git failed, and clients are told', async () => {
        conflicting();
        await pullThatConflicts();
        await actions.resolve(userId, repositoryId, { path: 'edited.md', resolution: 'ours' });
        published = [];
        vi.spyOn(merges, 'startOver').mockRejectedValueOnce(new GitOperationError('timeout', 'too slow'));

        await expect(actions.startOver(userId, repositoryId, 'edited.md'))
          .rejects.toMatchObject({ status: 504, code: 'git-timeout' });

        expect(await resolved('edited.md')).toBe(true);
        expect(published.map(({ type }) => type)).toEqual([ 'files.changed', 'git.changed' ]);
      });
    });
  });

  describe('commit', () => {
    const conflicting = () =>
      diverged(
        { 'edited.md': 'base\n', 'other.md': 'base\n', 'clean.md': 'one\ntwo\nthree\n' },
        { 'edited.md': 'mine\n', 'other.md': 'mine\n', 'clean.md': 'ONE\ntwo\nthree\n' },
        { 'edited.md': 'theirs\n', 'other.md': 'theirs\n', 'clean.md': 'one\ntwo\nTHREE\n' }
      );
    const resolveAll = async () => {
      await actions.resolve(userId, repositoryId, { path: 'edited.md', resolution: 'ours' });
      await actions.resolve(userId, repositoryId, { path: 'other.md', resolution: 'theirs' });
      published = [];
    };
    const out = (...args: string[]) => git(work, ...args).trim();
    const committed = (path: string) => out('show', `HEAD:${path}`);

    it('commits with the resolved files and what merged by itself, and the merge ends', async () => {
      conflicting();
      await pullThatConflicts();
      await resolveAll();

      const { oid } = await actions.commit(userId, repositoryId, 'Merge origin/main');

      expect(oid).toBe(out('rev-parse', 'HEAD'));
      expect([ committed('edited.md'), committed('other.md'), committed('clean.md') ])
        .toEqual([ 'mine', 'theirs', 'ONE\ntwo\nTHREE' ]);
      expect(out('log', '-1', '--format=%an <%ae>|%B')).toBe('Ada Lovelace <ada@example.com>|Merge origin/main');
      expect(mergeFiles()).toEqual([]);
    });

    it('has both parents', async () => {
      conflicting();
      const recorded = await pullThatConflicts();
      await resolveAll();

      await actions.commit(userId, repositoryId, 'Merge origin/main');

      expect(out('rev-list', '--parents', '-n', '1', 'HEAD').split(' ').slice(1))
        .toEqual([ recorded, out('rev-parse', 'origin/main') ]);
    });

    it('keeps the record, with the merge commit', async () => {
      conflicting();
      const recorded = await pullThatConflicts();
      await resolveAll();

      const { oid } = await actions.commit(userId, repositoryId, 'Merge origin/main');

      expect(syncState.record(repositoryId)).toEqual({ recordedCommit: recorded, mergeCommit: oid, applying: false });
      expect(refAt()).toBe(recorded);
    });

    it('leaves alone a record that is not this merge\'s', async () => {
      conflicting();
      const older = await merges.record(work);
      syncState.startMerge(repositoryId, older);
      syncState.mergeCommitted(repositoryId, 'the-merge-commit');
      await mergeThatConflicts();
      await resolveAll();

      await actions.commit(userId, repositoryId, 'Merge origin/main');

      expect(syncState.record(repositoryId)).toMatchObject({ recordedCommit: older, mergeCommit: 'the-merge-commit' });
    });

    it('keeps the record that only the ref still has, as abort finds it', async () => {
      conflicting();
      const recorded = await pullThatConflicts();
      await resolveAll();
      syncState.forgetRecord(repositoryId);

      const { oid } = await actions.commit(userId, repositoryId, 'Merge origin/main');

      expect(syncState.record(repositoryId)).toEqual({ recordedCommit: recorded, mergeCommit: oid, applying: false });
    });

    it('refuses a path git still has unmerged, also when the conflict list leaves it out', async () => {
      // Both sides renamed it, each to its own name, in a merge that git started by itself.
      diverged(
        { 'orig.md': 'a\nb\nc\n' },
        { 'orig.md': null, 'mine.md': 'a\nb\nc\n' },
        { 'orig.md': null, 'theirs.md': 'a\nb\nc\n' }
      );
      expect(() => git(work, 'merge', '--no-edit', 'origin/main')).toThrow();
      for (const path of [ 'mine.md', 'theirs.md' ]) {
        await actions.resolve(userId, repositoryId, { path, resolution: 'keep' });
      }
      published = [];

      await expect(actions.commit(userId, repositoryId, 'Merge')).rejects.toMatchObject({
        status: 409,
        code: 'merge-unresolved'
      });
      expect(await merges.mergeInProgress(work)).toBe(true);
      expect(published).toEqual([]);
    });

    it('says why git refused before it changed anything, and tells nobody', async () => {
      conflicting();
      await pullThatConflicts();
      await resolveAll();
      vi.spyOn(merges, 'commit')
        .mockRejectedValueOnce(new GitOperationError('detached-head', 'no branch'))
        .mockRejectedValueOnce(new GitOperationError('git-busy', 'index.lock'));

      await expect(actions.commit(userId, repositoryId, 'Merge')).rejects.toMatchObject({
        status: 409,
        code: 'detached-head'
      });
      await expect(actions.commit(userId, repositoryId, 'Merge')).rejects.toMatchObject({
        status: 409,
        code: 'git-busy'
      });
      expect(published).toEqual([]);
    });

    it('refuses an unconfirmed author, before anything else', async () => {
      authorConfirmed = false;

      await expect(actions.commit(userId, repositoryId, 'Merge')).rejects.toMatchObject({
        status: 409,
        code: 'commit-author-not-confirmed'
      });
      expect(published).toEqual([]);
    });

    it('refuses while a file is unresolved, and changes nothing', async () => {
      conflicting();
      await pullThatConflicts();
      await actions.resolve(userId, repositoryId, { path: 'edited.md', resolution: 'ours' });
      published = [];
      const before = snapshot();

      await expect(actions.commit(userId, repositoryId, 'Merge')).rejects.toMatchObject({
        status: 409,
        code: 'merge-unresolved'
      });

      expect(snapshot()).toEqual(before);
      expect(await merges.mergeInProgress(work)).toBe(true);
      expect(published).toEqual([]);
    });

    it('refuses without a merge', async () => {
      await expect(actions.commit(userId, repositoryId, 'Merge')).rejects.toMatchObject({
        status: 409,
        code: 'no-merge-in-progress'
      });
    });

    it('waits for a save in progress', async () => {
      conflicting();
      await pullThatConflicts();
      await resolveAll();
      const { promise: gate, resolve: release } = Promise.withResolvers<void>();
      const held = lock.run(repositoryId, () => gate);

      const committing = actions.commit(userId, repositoryId, 'Merge');
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(await merges.mergeInProgress(work)).toBe(true);

      release();
      await Promise.all([ held, committing ]);
      expect(await merges.mergeInProgress(work)).toBe(false);
    });

    it('publishes git.changed', async () => {
      conflicting();
      await pullThatConflicts();
      await resolveAll();

      await actions.commit(userId, repositoryId, 'Merge');

      expect(published).toEqual([ { type: 'git.changed', repositoryId } ]);
    });

    it('leaves the merge and its record after a failed commit, and clients are told', async () => {
      conflicting();
      const recorded = await pullThatConflicts();
      await resolveAll();
      vi.spyOn(merges, 'commit').mockRejectedValueOnce(new GitOperationError('timeout', 'too slow'));

      await expect(actions.commit(userId, repositoryId, 'Merge')).rejects.toMatchObject({
        status: 504,
        code: 'git-timeout'
      });

      expect(await merges.mergeInProgress(work)).toBe(true);
      expect(syncState.record(repositoryId)).toMatchObject({ recordedCommit: recorded, mergeCommit: null });
      expect(published).toEqual([ { type: 'git.changed', repositoryId } ]);
    });
  });
});
