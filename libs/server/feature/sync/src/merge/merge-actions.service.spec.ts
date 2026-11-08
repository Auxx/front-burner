import { Database } from '@front-burner/server-core-database';
import type { EventsHub } from '@front-burner/server-core-events';
import {
  GitEngine,
  GitMerge,
  GitOperationError,
  GitRunner,
  LocalGit,
  WorkingTreeLock
} from '@front-burner/server-core-git';
import { ApiErrorException } from '@front-burner/server-core-observability';
import type { OpenableRepository } from '@front-burner/server-feature-files';
import type { PushEvent } from '@front-burner/shared-contracts';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { MergeRecord } from '../state/merge-record';
import { SyncStateStore } from '../state/sync-state.store';
import { insertRepository, insertUser } from '../testing/fixtures';
import { createRemote, git, testGitOptions } from '../testing/git-fixtures';
import { createTestDatabase } from '../testing/test-database';
import { MergeActions } from './merge-actions.service';
import { MergeGuard } from './merge-guard';

const AUTHOR = { name: 'Ada Lovelace', email: 'ada@example.com' };
const REF = 'refs/front-burner/pre-merge';

type Files = Record<string, string | null>;

// Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
describe.skipIf(process.platform === 'win32')('MergeActions', () => {
  const options = testGitOptions();
  const runner = new GitRunner();
  const engine = new GitEngine(options, runner);
  const merges = new GitMerge(new LocalGit(runner), options);
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
      { publish: (_user: number, event: PushEvent) => published.push(event) } as unknown as EventsHub
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
});
