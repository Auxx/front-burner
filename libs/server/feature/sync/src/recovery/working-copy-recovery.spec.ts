import { Database, repositories } from '@front-burner/server-core-database';
import { GitMerge, GitOptions, GitRunner, LocalGit } from '@front-burner/server-core-git';
import { DataLayout } from '@front-burner/server-core-storage';
import { RepositoryQueries } from '@front-burner/server-feature-repositories';
import { Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SyncStateStore } from '../state/sync-state.store';
import { insertRepository, insertUser } from '../testing/fixtures';
import { git } from '../testing/git-fixtures';
import { createTestDatabase } from '../testing/test-database';
import { WorkingCopyRecovery } from './working-copy-recovery';

const REF = 'refs/front-burner/pre-merge';

// Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
describe.skipIf(process.platform === 'win32')('WorkingCopyRecovery', () => {
  let root: string;
  let database: Database;
  let layout: DataLayout;
  let syncState: SyncStateStore;
  let recovery: WorkingCopyRecovery;
  let alice: number;

  const gitOutput = (cwd: string, ...args: string[]) => git(cwd, ...args).trim();

  /** A ready repository with a working copy: `first.md` and an ignore rule for `ignored.log`. */
  function workingCopyOf(name: string): { id: number; work: string; } {
    const id = insertRepository(database, alice, { name });
    const work = layout.workingCopy(alice, id);
    mkdirSync(work, { recursive: true });
    git(work, 'init', '-q', '-b', 'main');
    writeFileSync(join(work, '.gitignore'), 'ignored.log\n');
    writeFileSync(join(work, 'first.md'), 'one\n');
    commitAll(work, 'first');
    return { id, work };
  }

  function commitAll(work: string, message: string): void {
    git(work, 'add', '-A');
    git(work, 'commit', '-q', '-m', message);
  }

  /** `theirs` has a change to `first.md` and a new file; `main` has its own change to `first.md`. */
  function divergedBranches(work: string): void {
    git(work, 'checkout', '-q', '-b', 'theirs');
    writeFileSync(join(work, 'first.md'), 'theirs\n');
    writeFileSync(join(work, 'second.md'), 'second\n');
    commitAll(work, 'theirs');
    git(work, 'checkout', '-q', 'main');
    writeFileSync(join(work, 'first.md'), 'mine\n');
    commitAll(work, 'mine');
  }

  /** Git stopped at a conflict, as a pull leaves it; gives the recorded commit. */
  function mergeInProgress(id: number, work: string): string {
    divergedBranches(work);
    const recorded = gitOutput(work, 'rev-parse', 'HEAD');
    git(work, 'update-ref', REF, recorded);
    syncState.startMerge(id, recorded);
    expect(() => git(work, 'merge', '--no-edit', 'theirs')).toThrow();
    return recorded;
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'fb-recovery-'));
    database = createTestDatabase();
    layout = new DataLayout(root);
    syncState = new SyncStateStore(database);
    alice = insertUser(database, 'alice@x.io');
    recovery = new WorkingCopyRecovery(
      new RepositoryQueries(database),
      new GitMerge(new LocalGit(new GitRunner()), { gitTimeoutMs: 60_000 } as GitOptions),
      syncState,
      layout
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    database.sqlite.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('removes a stale lock without ending a merge', async () => {
    const { id, work } = workingCopyOf('handbook');
    mergeInProgress(id, work);
    syncState.mergeStopped(id);
    writeFileSync(join(work, '.git', 'index.lock'), '');

    await recovery.onModuleInit();

    expect(existsSync(join(work, '.git', 'index.lock'))).toBe(false);
    expect(existsSync(join(work, '.git', 'MERGE_HEAD'))).toBe(true);
    expect(gitOutput(work, 'ls-files', '-u')).not.toBe('');
  });

  it('removes HEAD.lock and a ref\'s lock', async () => {
    const { work } = workingCopyOf('handbook');
    mkdirSync(join(work, '.git', 'refs', 'remotes', 'origin', 'topic'), { recursive: true });
    writeFileSync(join(work, '.git', 'HEAD.lock'), '');
    writeFileSync(join(work, '.git', 'refs', 'remotes', 'origin', 'topic', 'one.lock'), '');

    await recovery.onModuleInit();

    expect(existsSync(join(work, '.git', 'HEAD.lock'))).toBe(false);
    expect(existsSync(join(work, '.git', 'refs', 'remotes', 'origin', 'topic', 'one.lock'))).toBe(false);
  });

  it('undoes a merge cut short', async () => {
    const { id, work } = workingCopyOf('handbook');
    divergedBranches(work);
    const recorded = gitOutput(work, 'rev-parse', 'HEAD');
    git(work, 'update-ref', REF, recorded);
    syncState.startMerge(id, recorded);
    // What a killed git leaves: the branch moved, a half-written file, an untracked file, a lock.
    git(work, 'merge', '-q', '--no-edit', '-X', 'theirs', 'theirs');
    writeFileSync(join(work, 'first.md'), 'half wri');
    mkdirSync(join(work, 'newdir'));
    writeFileSync(join(work, 'newdir', 'partial.md'), 'left behind\n');
    writeFileSync(join(work, '.git', 'index.lock'), '');
    expect(gitOutput(work, 'rev-parse', 'HEAD')).not.toBe(recorded);
    const info = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    await recovery.onModuleInit();

    expect(gitOutput(work, 'rev-parse', 'HEAD')).toBe(recorded);
    expect(readFileSync(join(work, 'first.md'), 'utf8')).toBe('mine\n');
    expect(existsSync(join(work, 'second.md'))).toBe(false);
    expect(existsSync(join(work, 'newdir'))).toBe(false);
    expect(gitOutput(work, 'status', '--porcelain')).toBe('');
    expect(syncState.record(id).applying).toBe(false);
    expect(info).toHaveBeenCalledWith({ repositoryId: id, commit: recorded }, expect.any(String));
  });

  it('keeps ignored files when it undoes a merge', async () => {
    const { id, work } = workingCopyOf('handbook');
    const recorded = mergeInProgress(id, work);
    writeFileSync(join(work, 'ignored.log'), 'keep me\n');

    await recovery.onModuleInit();

    expect(gitOutput(work, 'rev-parse', 'HEAD')).toBe(recorded);
    expect(readFileSync(join(work, 'ignored.log'), 'utf8')).toBe('keep me\n');
  });

  it('gives back the record of an earlier merge', async () => {
    const { id, work } = workingCopyOf('handbook');
    const earlier = gitOutput(work, 'rev-parse', 'HEAD');
    syncState.startMerge(id, earlier);
    writeFileSync(join(work, 'merged.md'), 'merged\n');
    commitAll(work, 'an earlier merge');
    const earlierMerge = gitOutput(work, 'rev-parse', 'HEAD');
    syncState.mergeCommitted(id, earlierMerge);
    mergeInProgress(id, work);

    await recovery.onModuleInit();

    expect(syncState.record(id)).toEqual({ recordedCommit: earlier, mergeCommit: earlierMerge, applying: false });
    expect(gitOutput(work, 'rev-parse', REF)).toBe(earlier);
  });

  it('forgets the ref when no earlier merge was recorded', async () => {
    const { id, work } = workingCopyOf('handbook');
    mergeInProgress(id, work);

    await recovery.onModuleInit();

    expect(syncState.record(id)).toEqual({ recordedCommit: null, mergeCommit: null, applying: false });
    expect(() => git(work, 'rev-parse', '--verify', '-q', REF)).toThrow();
  });

  it('undoes a merge whose flag is still set, even with MERGE_HEAD', async () => {
    const { id, work } = workingCopyOf('handbook');
    const recorded = mergeInProgress(id, work);
    expect(existsSync(join(work, '.git', 'MERGE_HEAD'))).toBe(true);

    await recovery.onModuleInit();

    expect(existsSync(join(work, '.git', 'MERGE_HEAD'))).toBe(false);
    expect(gitOutput(work, 'rev-parse', 'HEAD')).toBe(recorded);
    expect(gitOutput(work, 'status', '--porcelain')).toBe('');
  });

  it('leaves a merge waiting for the user alone', async () => {
    const { id, work } = workingCopyOf('handbook');
    const recorded = mergeInProgress(id, work);
    syncState.mergeStopped(id);
    const markers = readFileSync(join(work, 'first.md'), 'utf8');
    expect(markers).toContain('<<<<<<<');
    const merged = gitOutput(work, 'ls-files', '-s', 'second.md');
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await recovery.onModuleInit();

    expect(existsSync(join(work, '.git', 'MERGE_HEAD'))).toBe(true);
    expect(readFileSync(join(work, 'first.md'), 'utf8')).toBe(markers);
    expect(gitOutput(work, 'ls-files', '-s', 'second.md')).toBe(merged);
    expect(gitOutput(work, 'ls-files', '-u')).not.toBe('');
    expect(syncState.record(id)).toEqual({ recordedCommit: recorded, mergeCommit: null, applying: false });
    expect(gitOutput(work, 'rev-parse', REF)).toBe(recorded);
    // The conflicting file is no reason to report a failed refresh.
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps what was resolved in a merge waiting for the user', async () => {
    const { id, work } = workingCopyOf('handbook');
    mergeInProgress(id, work);
    syncState.mergeStopped(id);
    writeFileSync(join(work, 'first.md'), 'resolved\n');
    git(work, 'add', 'first.md');
    const resolved = gitOutput(work, 'ls-files', '--resolve-undo');
    expect(resolved).not.toBe('');

    await recovery.onModuleInit();

    expect(existsSync(join(work, '.git', 'MERGE_HEAD'))).toBe(true);
    expect(readFileSync(join(work, 'first.md'), 'utf8')).toBe('resolved\n');
    expect(gitOutput(work, 'ls-files', '--resolve-undo')).toBe(resolved);
  });

  it('refreshes each index', async () => {
    const copies = [ workingCopyOf('one'), workingCopyOf('two') ];
    for (const { work } of copies) {
      // The same content with another time, as after a restore (A-5.14).
      utimesSync(join(work, 'first.md'), new Date(1_000_000), new Date(1_000_000));
      expect(gitOutput(work, 'diff-files', '--name-only')).toBe('first.md');
    }

    await recovery.onModuleInit();

    for (const { work } of copies) {
      expect(gitOutput(work, 'diff-files', '--name-only')).toBe('');
    }
  });

  it('carries on after a working copy fails', async () => {
    const broken = insertRepository(database, alice, { name: 'broken' });
    // Not a repository: git fails in it, and it has no `refs` to look through.
    mkdirSync(join(layout.workingCopy(alice, broken), '.git'), { recursive: true });
    const { work } = workingCopyOf('handbook');
    writeFileSync(join(work, '.git', 'index.lock'), '');
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await expect(recovery.onModuleInit()).resolves.toBeUndefined();

    expect(existsSync(join(work, '.git', 'index.lock'))).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain(`repository ${broken}`);
  });

  it('skips a repository that is not ready', async () => {
    const { id, work } = workingCopyOf('handbook');
    const recorded = mergeInProgress(id, work);
    writeFileSync(join(work, '.git', 'index.lock'), '');
    database.db.update(repositories).set({ status: 'error' }).where(eq(repositories.id, id)).run();

    await recovery.onModuleInit();

    expect(existsSync(join(work, '.git', 'index.lock'))).toBe(true);
    expect(existsSync(join(work, '.git', 'MERGE_HEAD'))).toBe(true);
    expect(syncState.record(id)).toEqual({ recordedCommit: recorded, mergeCommit: null, applying: true });
  });

  it('skips a ready repository whose working copy is gone', async () => {
    insertRepository(database, alice, { name: 'gone' });
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await recovery.onModuleInit();

    expect(warn).not.toHaveBeenCalled();
  });
});
