import { GitOperationError } from '@front-burner/server-core-git';
import type { FileContents } from '@front-burner/server-feature-files';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PULL_JOB_TYPE, pullDedupeKey } from '../pull/pull.job';
import { PUSH_JOB_TYPE, pushDedupeKey } from '../push/push.job';
import { git, refuseWithHook, trustTestCertificate } from '../testing/git-fixtures';
import { PushHarness } from '../testing/push-harness';
import { MergeActions } from './merge-actions.service';
import { MergeGuard } from './merge-guard';
import type { MergeStateService } from './merge-state.service';

const REF = 'refs/front-burner/pre-merge';

/**
 * **Undo merge** with real pulls and pushes (GC-25, GC-26, A-4.5a): what the
 * status offers, what the request does, and how a push forgets the record.
 */
// The broker listens on a Unix socket in a POSIX path: not on Windows.
describe.skipIf(process.platform === 'win32')('Undoing a merge', () => {
  let restoreCa: () => void;
  let harness: PushHarness;
  let actions: MergeActions;

  const work = () => harness.workingCopy;
  const head = (rev = 'HEAD') => git(work(), 'rev-parse', rev).trim();
  const record = () => harness.syncState.record(harness.repositoryId);
  const recordRef = () => {
    try {
      return git(work(), 'rev-parse', '--verify', '-q', REF).trim();
    } catch {
      return null;
    }
  };
  const resultOf = (id: number) => JSON.parse(harness.jobOf(id)?.result ?? 'null') as unknown;
  const run = async (type: string, dedupeKey: string) => {
    const id = harness.runner.enqueue({
      type,
      userId: harness.alice,
      repositoryId: harness.repositoryId,
      payload: { branch: 'main' },
      dedupeKey
    });
    await harness.finished(id);
    expect(harness.jobOf(id)?.status).toBe('done');
    return resultOf(id);
  };
  const pulled = () => run(PULL_JOB_TYPE, pullDedupeKey(harness.repositoryId, 'main'));
  const pushed = () => run(PUSH_JOB_TYPE, pushDedupeKey(harness.repositoryId, 'main'));
  /** What the status says (GC-25), as `GET …/git/status` works it out. */
  const offered = async () => {
    const [ status, mergeInProgress ] = await Promise.all([
      harness.engine.status(work()),
      harness.merge.mergeInProgress(work())
    ]);
    return actions.isUndoable(harness.repositoryId, work(), {
      branch: status.branch,
      head: head(),
      clean: status.changes.length === 0,
      mergeInProgress
    });
  };
  const undo = () => actions.undo(harness.alice, harness.repositoryId);
  /** A pull that makes a merge commit: a commit here, another on the remote. */
  const mergedPull = async (name: string) => {
    harness.commitFile(`${name}-mine.md`, 'mine\n');
    harness.pushFileFromElsewhere(`${name}-theirs.md`, 'theirs\n');
    expect(await pulled()).toMatchObject({ kind: 'pulled', result: 'merged' });
    return { recordedCommit: head('HEAD^1'), mergeCommit: head() };
  };
  /** The remote adds the file that `mergedPull('a')` committed here: the next pull conflicts, with the merge as `HEAD`. */
  const conflictOnTopOfTheMerge = () => harness.pushFileFromElsewhere('a-mine.md', 'theirs\n');
  /** Pushes the branch as another device does, behind the product's back. */
  const pushedElsewhere = () => {
    git(work(), 'push', '-q', harness.bare, 'HEAD:main');
    git(join(harness.root, 'seed'), 'pull', '-q', harness.bare, 'main');
  };

  beforeAll(() => {
    restoreCa = trustTestCertificate();
  });

  afterAll(() => {
    restoreCa();
  });

  beforeEach(async () => {
    harness = await PushHarness.start();
    harness.confirmAuthor();
    actions = new MergeActions(
      harness.openable,
      new MergeGuard(harness.workingTreeLock, harness.merge),
      harness.merge,
      harness.syncState,
      harness.mergeRecord,
      harness.events,
      {} as MergeStateService,
      {} as FileContents,
      harness.commitAuthors,
      harness.engine,
      harness.guard,
      harness.networkLock
    );
    harness.runner.start();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await harness.close();
  });

  it('offers undo after a merge commit', async () => {
    const merge = await mergedPull('a');

    expect(record()).toEqual({ ...merge, applying: false });
    expect(await offered()).toBe(true);
  });

  it('is not offered after a pull that made no merge commit', async () => {
    expect(await pulled()).toMatchObject({ result: 'up-to-date' });
    expect(await offered()).toBe(false);

    harness.pushFileFromElsewhere('theirs.md', 'theirs\n');
    expect(await pulled()).toMatchObject({ result: 'fast-forward' });
    expect(await offered()).toBe(false);
    await expect(undo()).rejects.toMatchObject({ status: 409, code: 'undo-not-allowed' });
  });

  it('is not offered after a fast-forward', async () => {
    await mergedPull('a');
    // Another device pushes the merge and builds on it; the merge is then on a remote branch.
    pushedElsewhere();
    harness.pushFileFromElsewhere('later.md', 'later\n');
    git(work(), 'fetch', '-q', harness.bare, '+refs/heads/main:refs/remotes/origin/main');
    expect(await offered()).toBe(false);

    expect(await pulled()).toMatchObject({ result: 'fast-forward' });

    expect(await offered()).toBe(false);
    expect(record()).toEqual({ recordedCommit: null, mergeCommit: null, applying: false });
  });

  describe('stays offered after a pull that left the merge as it was', () => {
    it('when there was nothing to pull', async () => {
      const merge = await mergedPull('a');

      expect(await pulled()).toMatchObject({ result: 'up-to-date' });

      expect(record()).toEqual({ ...merge, applying: false });
      expect(await offered()).toBe(true);
    });

    it('when the pull failed', async () => {
      const merge = await mergedPull('a');
      writeFileSync(join(work(), '.git', 'info', 'exclude'), 'out.txt\n');
      writeFileSync(join(work(), 'out.txt'), 'mine, ignored\n');
      harness.pushFileFromElsewhere('out.txt', 'theirs\n');

      expect(await pulled()).toMatchObject({ kind: 'failed', code: 'merge-blocked' });

      expect(record()).toEqual({ ...merge, applying: false });
      expect(await offered()).toBe(true);
    });

    it('when the pull conflicted and was aborted', async () => {
      const merge = await mergedPull('a');
      conflictOnTopOfTheMerge();
      expect(await pulled()).toMatchObject({ result: 'conflicted' });
      expect(await offered()).toBe(false);

      await actions.abort(harness.alice, harness.repositoryId);

      expect(head()).toBe(merge.mergeCommit);
      expect(record()).toEqual({ ...merge, applying: false });
      expect(await offered()).toBe(true);
    });
  });

  it('undoes the merge and shows the upstream\'s commits again', async () => {
    const { recordedCommit } = await mergedPull('a');

    await undo();

    expect(head()).toBe(recordedCommit);
    expect(existsSync(join(work(), 'a-theirs.md'))).toBe(false);
    expect(readFileSync(join(work(), 'a-mine.md'), 'utf8')).toBe('mine\n');
    expect(await harness.engine.status(work())).toMatchObject({ ahead: 1, behind: 1, changes: [] });
    expect(record()).toEqual({ recordedCommit: null, mergeCommit: null, applying: false });
    expect(recordRef()).toBeNull();
    expect(await offered()).toBe(false);
  });

  it('undoes only the last merge', async () => {
    const first = await mergedPull('a');
    const second = await mergedPull('b');
    expect(second.recordedCommit).not.toBe(first.mergeCommit);
    expect(record()).toEqual({ ...second, applying: false });

    await undo();

    expect(head()).toBe(second.recordedCommit);
    expect(head('HEAD^')).toBe(first.mergeCommit);
    expect(await offered()).toBe(false);
    await expect(undo()).rejects.toMatchObject({ code: 'undo-not-allowed' });
  });

  it('refuses after another commit, which is not lost', async () => {
    await mergedPull('a');
    harness.commitFile('later.md', 'later\n');
    const later = head();
    harness.published.length = 0;

    expect(await offered()).toBe(false);
    await expect(undo()).rejects.toMatchObject({ status: 409, code: 'undo-not-allowed' });

    expect(head()).toBe(later);
    expect(harness.published).toEqual([]);
  });

  it('refuses with uncommitted changes, checked inside the lock', async () => {
    const { mergeCommit } = await mergedPull('a');
    expect(await offered()).toBe(true);
    const { promise: gate, resolve: release } = Promise.withResolvers<void>();
    const held = harness.workingTreeLock.run(harness.repositoryId, () => gate);

    const undoing = undo();
    // A save that came in before the undo, as the user typed.
    writeFileSync(join(work(), 'a-mine.md'), 'typed\n');
    release();

    await expect(undoing).rejects.toMatchObject({ status: 409, code: 'undo-not-allowed' });
    await held;
    expect(head()).toBe(mergeCommit);
    expect(readFileSync(join(work(), 'a-mine.md'), 'utf8')).toBe('typed\n');
    expect(record()).toMatchObject({ mergeCommit });
  });

  it('waits for a push under way, and refuses once it has published the merge', async () => {
    const { mergeCommit } = await mergedPull('a');
    const { promise: gate, resolve: release } = Promise.withResolvers<void>();
    // A push that holds the network lock while it sends the merge commit.
    const pushing = harness.networkLock.run(harness.repositoryId, async () => {
      await gate;
      git(work(), 'push', '-q', harness.bare, 'HEAD:main');
      git(work(), 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    });

    const undoing = undo();
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(head()).toBe(mergeCommit);
    release();

    await expect(undoing).rejects.toMatchObject({ status: 409, code: 'undo-not-allowed' });
    await pushing;
    expect(head()).toBe(mergeCommit);
  });

  it('is neither offered nor done on a detached HEAD at the merge commit', async () => {
    const { mergeCommit } = await mergedPull('a');
    git(work(), 'switch', '-q', '--detach', 'HEAD');

    expect(await offered()).toBe(false);
    await expect(undo()).rejects.toMatchObject({ code: 'undo-not-allowed' });

    expect(head()).toBe(mergeCommit);
    expect(head('main')).toBe(mergeCommit);
  });

  it('refuses during a merge', async () => {
    await mergedPull('a');
    conflictOnTopOfTheMerge();
    expect(await pulled()).toMatchObject({ result: 'conflicted' });

    await expect(undo()).rejects.toMatchObject({ status: 409, code: 'merge-in-progress' });
  });

  it('refuses after a push', async () => {
    const { mergeCommit } = await mergedPull('a');

    expect(await pushed()).toMatchObject({ kind: 'pushed' });

    expect(await offered()).toBe(false);
    await expect(undo()).rejects.toMatchObject({ code: 'undo-not-allowed' });
    expect(head()).toBe(mergeCommit);
  });

  it('refuses a merge pushed from another device, without any bookkeeping', async () => {
    const merge = await mergedPull('a');
    pushedElsewhere();
    git(work(), 'fetch', '-q', harness.bare, '+refs/heads/main:refs/remotes/origin/main');

    expect(await offered()).toBe(false);
    await expect(undo()).rejects.toMatchObject({ code: 'undo-not-allowed' });
    expect(record()).toEqual({ ...merge, applying: false });
  });

  it('forgets the record after a successful push', async () => {
    await mergedPull('a');

    await pushed();

    expect(record()).toEqual({ recordedCommit: null, mergeCommit: null, applying: false });
    expect(recordRef()).toBeNull();
  });

  it('keeps the record after a failed push', async () => {
    const merge = await mergedPull('a');
    refuseWithHook(harness.bare, 'echo "Pushes are frozen." >&2');

    expect(await pushed()).toMatchObject({ kind: 'failed', code: 'push-rejected' });

    expect(record()).toEqual({ ...merge, applying: false });
    expect(recordRef()).toBe(merge.recordedCommit);
    expect(await offered()).toBe(true);
  });

  it('keeps the record when a push published other commits only', async () => {
    const merge = await mergedPull('a');
    // Another branch, from before the merge, is published.
    git(work(), 'update-ref', 'refs/remotes/origin/topic', merge.recordedCommit);

    await harness.mergeRecord.forgetIfPushed(harness.repositoryId, work());

    expect(record()).toEqual({ ...merge, applying: false });
    expect(await offered()).toBe(true);
  });

  it('publishes files.changed and git.changed', async () => {
    await mergedPull('a');
    harness.published.length = 0;

    await undo();

    expect(harness.published.map(({ event }) => event)).toEqual([
      { type: 'files.changed', repositoryId: harness.repositoryId, folders: 'all' },
      { type: 'git.changed', repositoryId: harness.repositoryId }
    ]);
  });

  it('leaves the branch as it was when the reset fails, and clients are told', async () => {
    const merge = await mergedPull('a');
    harness.published.length = 0;
    vi.spyOn(harness.merge, 'resetTo').mockRejectedValueOnce(new GitOperationError('timeout', 'too slow'));

    await expect(undo()).rejects.toMatchObject({ status: 504, code: 'git-timeout' });

    expect(head()).toBe(merge.mergeCommit);
    expect(record()).toEqual({ ...merge, applying: false });
    expect(harness.published.map(({ event }) => event.type)).toEqual([ 'files.changed', 'git.changed' ]);
  });
});
