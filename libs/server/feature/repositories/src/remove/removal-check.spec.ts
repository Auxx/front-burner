import { Database } from '@front-burner/server-core-database';
import { GitEngine, GitRunner } from '@front-burner/server-core-git';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { DataLayout } from '@front-burner/server-core-storage';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { RepositoryQueries } from '../repositories/repository-queries';
import { insertRepository, insertUser } from '../testing/fixtures';
import { createRemotes, git, testGitOptions } from '../testing/git-fixtures';
import { createTestDatabase } from '../testing/test-database';
import { RemovalCheck } from './removal-check';

describe('RemovalCheck', () => {
  let root: string;
  let database: Database;
  let layout: DataLayout;
  let check: RemovalCheck;
  let alice: number;
  let handbook: number;
  let work: string;

  const nothing = { uncommittedFiles: 0, unpushedCommits: 0, mergeInProgress: false, unreadable: false };
  const commit = (message: string) => git(work, 'commit', '-q', '--allow-empty', '-m', message);

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'fb-removal-check-'));
    const remotes = createRemotes(root);
    database = createTestDatabase();
    layout = new DataLayout(join(root, 'data'));
    check = new RemovalCheck(new RepositoryQueries(database), new GitEngine(testGitOptions(), new GitRunner()), layout);
    alice = insertUser(database, 'alice@example.com');
    handbook = insertRepository(database, alice, { name: 'handbook' });
    work = layout.workingCopy(alice, handbook);
    mkdirSync(dirname(work), { recursive: true });
    git(root, 'clone', '-q', remotes.handbook, work);
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('answers nothing to lose for a clean working copy', async () => {
    expect(await check.of(alice, handbook)).toEqual(nothing);
  });

  it('counts uncommitted files and commits not pushed', async () => {
    commit('one');
    commit('two');
    commit('three');
    writeFileSync(join(work, 'a.md'), 'a\n');
    writeFileSync(join(work, 'b.md'), 'b\n');

    expect(await check.of(alice, handbook)).toEqual({ ...nothing, uncommittedFiles: 2, unpushedCommits: 3 });
  });

  it('counts the commits of a branch that was never pushed', async () => {
    git(work, 'checkout', '-q', '-b', 'local');
    commit('local');
    git(work, 'checkout', '-q', 'main');

    expect(await check.of(alice, handbook)).toEqual({ ...nothing, unpushedCommits: 1 });
  });

  it('answers nothing to lose for a failed clone, without running git', async () => {
    const failed = insertRepository(database, alice, { name: 'failed', status: 'error', errorCode: 'clone-failed' });

    expect(await check.of(alice, failed)).toEqual(nothing);
  });

  it('answers nothing to lose while cloning', async () => {
    const cloning = insertRepository(database, alice, { name: 'cloning', status: 'cloning' });

    expect(await check.of(alice, cloning)).toEqual(nothing);
  });

  it('an unreadable working copy is reported as such', async () => {
    rmSync(join(work, '.git'), { recursive: true, force: true });

    expect(await check.of(alice, handbook)).toEqual({ ...nothing, unreadable: true });
  });

  it('a working copy already marked missing is unreadable', async () => {
    const damaged = insertRepository(database, alice, {
      name: 'damaged',
      status: 'error',
      errorCode: 'working-copy-missing'
    });

    expect(await check.of(alice, damaged)).toEqual({ ...nothing, unreadable: true });
  });

  it('never changes the status', async () => {
    rmSync(join(work, '.git'), { recursive: true, force: true });

    await check.of(alice, handbook);

    expect(new RepositoryQueries(database).find(alice, handbook)?.status).toBe('ready');
  });

  it('answers another user\'s repository like a missing one', async () => {
    const bob = insertUser(database, 'bob@example.com');

    const failure = await check.of(bob, handbook).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiErrorException);
    expect((failure as ApiErrorException).getStatus()).toBe(404);
    expect((failure as ApiErrorException).code).toBe('not-found');
  });
});
