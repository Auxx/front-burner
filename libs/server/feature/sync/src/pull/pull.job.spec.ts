import { GitOperationError, unlockPrivateKey } from '@front-burner/server-core-git';
import { sshKeyFixture } from '@front-burner/server-core-git/testing';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { git, trustTestCertificate } from '../testing/git-fixtures';
import { PushHarness } from '../testing/push-harness';
import { PULL_JOB_TYPE, pullDedupeKey } from './pull.job';

// The broker listens on a Unix socket in a POSIX path: not on Windows.
describe.skipIf(process.platform === 'win32')('PullJob', () => {
  let restoreCa: () => void;
  let harness: PushHarness;

  const enqueue = (branch = 'main') =>
    harness.runner.enqueue({
      type: PULL_JOB_TYPE,
      userId: harness.alice,
      repositoryId: harness.repositoryId,
      payload: { branch },
      dedupeKey: pullDedupeKey(harness.repositoryId, branch)
    });
  const resultOf = (id: number) => JSON.parse(harness.jobOf(id)?.result ?? 'null') as unknown;
  /** Pulls as a job and gives its result. */
  const pulled = async (branch = 'main') => {
    const id = enqueue(branch);
    await harness.finished(id);
    expect(harness.jobOf(id)?.status).toBe('done');
    return resultOf(id);
  };
  const head = (rev = 'HEAD') => git(harness.workingCopy, 'rev-parse', rev).trim();
  const recordRef = () => {
    try {
      return git(harness.workingCopy, 'rev-parse', '--verify', '-q', 'refs/front-burner/pre-merge').trim();
    } catch {
      return null;
    }
  };
  const record = () => harness.syncState.record(harness.repositoryId);
  const merging = () => existsSync(join(harness.workingCopy, '.git', 'MERGE_HEAD'));
  const published = (type: string) => harness.published.filter(({ event }) => event.type === type);

  /** As an earlier pull's merge that was not pushed: a record that **Undo merge** could use (GC-25). */
  function earlierMerge(): { recordedCommit: string; mergeCommit: string; } {
    const recordedCommit = head();
    harness.commit('as if merged');
    const mergeCommit = head();
    harness.syncState.startMerge(harness.repositoryId, recordedCommit);
    harness.syncState.mergeCommitted(harness.repositoryId, mergeCommit);
    git(harness.workingCopy, 'update-ref', 'refs/front-burner/pre-merge', recordedCommit);
    return { recordedCommit, mergeCommit };
  }

  beforeAll(() => {
    restoreCa = trustTestCertificate();
  });

  afterAll(() => {
    restoreCa();
  });

  beforeEach(async () => {
    harness = await PushHarness.start();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await harness.close();
  });

  it('reports each kind of result, with its count and upstream', async () => {
    harness.confirmAuthor();
    harness.runner.start();

    expect(await pulled()).toEqual({ kind: 'pulled', result: 'up-to-date', commits: 0, upstream: 'origin/main' });

    harness.pushFileFromElsewhere('a.md', 'a\n');
    expect(await pulled()).toEqual({ kind: 'pulled', result: 'fast-forward', commits: 1, upstream: 'origin/main' });

    harness.commitFile('mine.md', 'mine\n');
    harness.pushFileFromElsewhere('b.md', 'b\n');
    harness.pushFileFromElsewhere('c.md', 'c\n');
    expect(await pulled()).toEqual({ kind: 'pulled', result: 'merged', commits: 2, upstream: 'origin/main' });

    harness.commitFile('notes.md', 'mine\n');
    harness.pushFileFromElsewhere('notes.md', 'theirs\n');
    expect(await pulled()).toEqual({ kind: 'pulled', result: 'conflicted', commits: 1, upstream: 'origin/main' });
  });

  it('merges the remote branch when a local branch is named like it', async () => {
    harness.pushFileFromElsewhere('a.md', 'a\n');
    // git then prints the upstream as `remotes/origin/main`, and `origin/main` names the local branch.
    git(harness.workingCopy, 'branch', 'origin/main');
    harness.runner.start();

    expect(await pulled()).toEqual({ kind: 'pulled', result: 'fast-forward', commits: 1, upstream: 'origin/main' });

    expect(head()).toBe(head('refs/remotes/origin/main'));
    expect(git(harness.workingCopy, 'log', '-1', '--format=%s').trim()).toBe('change a.md');
  });

  it('leaves a merge in progress on a conflict, with the record kept', async () => {
    harness.confirmAuthor();
    harness.commitFile('notes.md', 'mine\n');
    harness.pushFileFromElsewhere('notes.md', 'theirs\n');
    const before = head();
    harness.runner.start();

    expect(await pulled()).toMatchObject({ result: 'conflicted' });

    expect(merging()).toBe(true);
    expect(head()).toBe(before);
    expect(readFileSync(join(harness.workingCopy, 'notes.md'), 'utf8')).toBe(
      '<<<<<<< main\nmine\n=======\ntheirs\n>>>>>>> origin/main\n'
    );
    expect(record()).toEqual({ recordedCommit: before, mergeCommit: null, applying: false });
    expect(recordRef()).toBe(before);
  });

  it('forgets the record after a fast-forward', async () => {
    earlierMerge();
    git(harness.workingCopy, 'push', '-q', harness.bare, 'main');
    git(harness.workingCopy, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    git(join(harness.root, 'seed'), 'pull', '-q', '--ff-only', harness.bare, 'main');
    harness.pushFileFromElsewhere('a.md', 'a\n');
    harness.runner.start();

    expect(await pulled()).toMatchObject({ result: 'fast-forward' });

    expect(record()).toEqual({ recordedCommit: null, mergeCommit: null, applying: false });
    expect(recordRef()).toBeNull();
  });

  it('sets the merge commit after a merge', async () => {
    harness.confirmAuthor();
    earlierMerge();
    harness.pushFileFromElsewhere('a.md', 'a\n');
    const before = head();
    harness.runner.start();

    expect(await pulled()).toMatchObject({ result: 'merged' });

    expect(record()).toEqual({ recordedCommit: before, mergeCommit: head(), applying: false });
    expect(recordRef()).toBe(before);
    expect(head('HEAD^1')).toBe(before);
    expect(git(harness.workingCopy, 'log', '-1', '--format=%an <%ae> / %cn <%ce>').trim()).toBe(
      'Alice Example <alice@example.com> / Alice Example <alice@example.com>'
    );
  });

  it('leaves the record alone when nothing is to merge', async () => {
    const earlier = earlierMerge();
    harness.runner.start();

    expect(await pulled()).toMatchObject({ result: 'up-to-date' });

    expect(record()).toEqual({ ...earlier, applying: false });
    expect(recordRef()).toBe(earlier.recordedCommit);
  });

  it('gives the earlier record back when the merge is blocked or fails', async () => {
    harness.confirmAuthor();
    const earlier = earlierMerge();
    writeFileSync(join(harness.workingCopy, '.git', 'info', 'exclude'), 'out.txt\n');
    writeFileSync(join(harness.workingCopy, 'out.txt'), 'mine, ignored\n');
    harness.pushFileFromElsewhere('out.txt', 'theirs\n');
    harness.runner.start();

    expect(await pulled()).toEqual({ kind: 'failed', code: 'merge-blocked', params: { paths: 'out.txt' } });
    expect(record()).toEqual({ ...earlier, applying: false });
    expect(recordRef()).toBe(earlier.recordedCommit);

    vi.spyOn(harness.merge, 'merge').mockRejectedValueOnce(new GitOperationError('timeout', 'killed'));
    expect(await pulled()).toEqual({ kind: 'failed', code: 'git-timeout', params: {} });
    expect(record()).toEqual({ ...earlier, applying: false });
    expect(recordRef()).toBe(earlier.recordedCommit);

    // Without an earlier record, none is left.
    harness.syncState.forgetRecord(harness.repositoryId);
    git(harness.workingCopy, 'update-ref', '-d', 'refs/front-burner/pre-merge');
    expect(await pulled()).toMatchObject({ kind: 'failed', code: 'merge-blocked' });
    expect(record()).toEqual({ recordedCommit: null, mergeCommit: null, applying: false });
    expect(recordRef()).toBeNull();
    expect(readFileSync(join(harness.workingCopy, 'out.txt'), 'utf8')).toBe('mine, ignored\n');
  });

  it('lists the ignored files a merge would overwrite', async () => {
    harness.confirmAuthor();
    const workingCopy = harness.workingCopy;
    writeFileSync(join(workingCopy, '.git', 'info', 'exclude'), 'out/\nnotes.txt\n');
    // A commit of the user's own, so that the merge is a true merge, which git does not protect them in.
    harness.commitFile('mine.md', 'mine\n');
    mkdirSync(join(workingCopy, 'out'));
    writeFileSync(join(workingCopy, 'out', 'site.html'), 'mine\n');
    writeFileSync(join(workingCopy, 'notes.txt'), 'mine\n');
    harness.pushFileFromElsewhere('notes.txt', 'theirs\n');
    harness.pushFileFromElsewhere('out/site.html', 'theirs\n');
    harness.pushFileFromElsewhere('other.md', 'theirs\n');
    const before = head();
    harness.runner.start();

    const result = await pulled() as { code: string; params: { paths: string; }; };

    expect(result.code).toBe('merge-blocked');
    expect(result.params.paths.split('\n').sort()).toEqual([ 'notes.txt', expect.stringMatching(/^out/) ]);
    expect(head()).toBe(before);
    expect(merging()).toBe(false);
    expect(readFileSync(join(workingCopy, 'notes.txt'), 'utf8')).toBe('mine\n');
    expect(readFileSync(join(workingCopy, 'out', 'site.html'), 'utf8')).toBe('mine\n');
  });

  it('refuses a save made during the fetch', async () => {
    harness.commitFile('notes.md', 'base\n');
    harness.pushFileFromElsewhere('a.md', 'a\n');
    const before = head();
    const fetch = harness.engine.fetch.bind(harness.engine);
    vi.spyOn(harness.engine, 'fetch').mockImplementation(async (workingCopy, request) => {
      const fetched = await fetch(workingCopy, request);
      // A save that arrives while the pull fetches.
      writeFileSync(join(harness.workingCopy, 'notes.md'), 'saved during the fetch\n');
      return fetched;
    });
    harness.runner.start();

    expect(await pulled()).toEqual({ kind: 'failed', code: 'uncommitted-changes', params: {} });

    expect(head()).toBe(before);
    expect(readFileSync(join(harness.workingCopy, 'notes.md'), 'utf8')).toBe('saved during the fetch\n');
    // The fetched commits stay.
    expect(git(harness.workingCopy, 'log', '-1', '--format=%s', 'origin/main').trim()).toBe('change a.md');
    expect(record()).toEqual({ recordedCommit: null, mergeCommit: null, applying: false });
  });

  it('refuses when the branch changed', async () => {
    harness.pushFileFromElsewhere('a.md', 'a\n');
    const main = head('main');
    const id = enqueue('main');
    git(harness.workingCopy, 'checkout', '-q', '-b', 'other', '--track', 'origin/main');
    harness.runner.start();
    await harness.finished(id);

    expect(resultOf(id)).toEqual({ kind: 'failed', code: 'branch-changed', params: { branch: 'main' } });
    expect(head('main')).toBe(main);
    expect(head('other')).toBe(main);
  });

  it('a merge that fails is undone', async () => {
    harness.confirmAuthor();
    const workingCopy = harness.workingCopy;
    writeFileSync(join(workingCopy, '.git', 'info', 'exclude'), 'build/\n');
    mkdirSync(join(workingCopy, 'build'));
    writeFileSync(join(workingCopy, 'build', 'site.html'), 'built\n');
    harness.commitFile('notes.md', 'mine\n');
    harness.pushFileFromElsewhere('notes.md', 'theirs\n');
    const before = head();
    vi.spyOn(harness.merge, 'merge').mockImplementationOnce(async () => {
      // As a merge killed at its timeout: files half written, a new one, and the index lock left behind.
      writeFileSync(join(workingCopy, 'notes.md'), 'half\n');
      writeFileSync(join(workingCopy, 'stray.md'), 'stray\n');
      writeFileSync(join(workingCopy, '.git', 'index.lock'), '');
      throw new GitOperationError('timeout', 'killed');
    });
    harness.runner.start();

    expect(await pulled()).toEqual({ kind: 'failed', code: 'git-timeout', params: {} });

    expect(head()).toBe(before);
    expect(readFileSync(join(workingCopy, 'notes.md'), 'utf8')).toBe('mine\n');
    expect(existsSync(join(workingCopy, 'stray.md'))).toBe(false);
    expect(existsSync(join(workingCopy, '.git', 'index.lock'))).toBe(false);
    expect(git(workingCopy, 'status', '--porcelain').trim()).toBe('');
    // Ignored files are not git's to clean.
    expect(readFileSync(join(workingCopy, 'build', 'site.html'), 'utf8')).toBe('built\n');
    expect(record()).toEqual({ recordedCommit: null, mergeCommit: null, applying: false });
  });

  it('asks for the author only when a merge commit is needed', async () => {
    harness.runner.start();
    harness.pushFileFromElsewhere('a.md', 'a\n');

    expect(await pulled()).toMatchObject({ result: 'fast-forward' });

    harness.commitFile('mine.md', 'mine\n');
    harness.pushFileFromElsewhere('b.md', 'b\n');
    const before = head();
    expect(await pulled()).toEqual({ kind: 'failed', code: 'commit-author-not-confirmed', params: {} });
    expect(head()).toBe(before);
    // The fetched commits stay, and nothing was recorded.
    expect(git(harness.workingCopy, 'log', '-1', '--format=%s', 'origin/main').trim()).toBe('change b.md');
    expect(record()).toEqual({ recordedCommit: null, mergeCommit: null, applying: false });
    expect(recordRef()).toBeNull();

    harness.confirmAuthor();
    expect(await pulled()).toEqual({ kind: 'pulled', result: 'merged', commits: 1, upstream: 'origin/main' });
  });

  it('reports a fetch\'s credential problems by their codes', async () => {
    await harness.serve({ users: { alice: 'token' } });
    harness.pushFileFromElsewhere('a.md', 'a\n');
    const before = head();
    harness.runner.start();

    expect(await pulled()).toEqual({ kind: 'failed', code: 'no-credentials', params: { host: '127.0.0.1' } });

    harness.useRemote('https://127.0.0.1:1/handbook.git');
    expect(await pulled()).toEqual({ kind: 'failed', code: 'host-unreachable', params: { host: '127.0.0.1' } });
    expect(head()).toBe(before);
  });

  it('publishes git.changed and files.changed', async () => {
    harness.pushFileFromElsewhere('a.md', 'a\n');
    harness.runner.start();

    await pulled();
    expect(published('files.changed')).toEqual([
      { userId: harness.alice, event: { type: 'files.changed', repositoryId: harness.repositoryId, folders: 'all' } }
    ]);
    expect(published('git.changed').length).toBeGreaterThan(0);

    const gitChanged = published('git.changed').length;
    await pulled();
    // Nothing to merge: no file changed.
    expect(published('files.changed')).toHaveLength(1);
    expect(published('git.changed').length).toBeGreaterThan(gitChanged);
  });

  it('drops the key copy when it ends', async () => {
    harness.runner.start();
    const id = enqueue();
    harness.jobKeys.hold(id, 1, unlockPrivateKey(sshKeyFixture('ed25519')));
    await harness.finished(id);

    expect(harness.jobKeys.take(id, 1)).toBeUndefined();
  });
});
