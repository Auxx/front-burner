import { EventsHub } from '@front-burner/server-core-events';
import {
  GitBranches,
  GitEngine,
  GitMerge,
  GitOperationError,
  GitOptions,
  GitRunner,
  LocalGit,
  WorkingTreeLock
} from '@front-burner/server-core-git';
import { ApiErrorException, ApiExceptionFilter } from '@front-burner/server-core-observability';
import type { DataLayout } from '@front-burner/server-core-storage';
import { FileContents, OpenableRepository, WorkingTreeGuard } from '@front-burner/server-feature-files';
import { CommitAuthors } from '@front-burner/server-feature-preferences';
import type { GitStatus, PushEvent, RepositoryCommitAuthor } from '@front-burner/shared-contracts';
import { INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { FetchScheduler } from '../fetch/fetch-scheduler';
import { FetchService } from '../fetch/fetch.service';
import { GitJobs } from '../jobs/git-jobs.service';
import { MergeActions } from '../merge/merge-actions.service';
import { MergeGuard } from '../merge/merge-guard';
import { MergeStateService } from '../merge/merge-state.service';
import { PullService } from '../pull/pull.service';
import { PushService } from '../push/push.service';
import { MergeRecord } from '../state/merge-record';
import { SyncStateStore } from '../state/sync-state.store';
import { GitController } from './git.controller';

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
  execFileSync('git', args, { cwd, env: gitEnv, stdio: 'pipe', encoding: 'utf8' });

const options: GitOptions = {
  helpersDir: '/nonexistent',
  egress: { blockPrivateNetworks: true },
  cloneTimeoutMs: 60_000,
  gitTimeoutMs: 60_000,
  knownHosts: []
};

const USER = 3;
const READY = 7;
const CLONING = 8;

const ADA = { name: 'Ada Lovelace', email: 'ada@example.com' };

describe('GitController', () => {
  let root: string;
  let app: INestApplication;
  let commitAuthor: RepositoryCommitAuthor;
  let published: PushEvent[];
  let fileOpened: ReturnType<typeof vi.fn<FetchScheduler['fileOpened']>>;
  let cloneMode: 'full' | 'single-branch';

  const status = (id = READY) => request(app.getHttpServer()).get(`/repositories/${id}/git/status`);
  const commit = (body: object, id = READY) =>
    request(app.getHttpServer()).post(`/repositories/${id}/git/commits`).send(body);
  const discard = (body: object, id = READY) =>
    request(app.getHttpServer()).post(`/repositories/${id}/git/discard`).send(body);
  const authorOf = (rev = 'HEAD') => git(root, 'log', '-1', '--format=%an <%ae> / %cn <%ce>', rev).trim();

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'fb-git-controller-'));
    git(root, 'init', '-q', '-b', 'main');
    writeFileSync(join(root, 'notes.md'), 'base\n');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'base');
    commitAuthor = { author: ADA, source: 'default', confirmed: true };
    published = [];
    fileOpened = vi.fn();
    cloneMode = 'full';
    const repositories = {
      root: (userId: number, id: number) => {
        if (userId !== USER || (id !== READY && id !== CLONING)) {
          throw new ApiErrorException(404, 'not-found');
        }
        if (id === CLONING) {
          throw new ApiErrorException(409, 'repository-not-openable', { status: 'cloning' });
        }
        return root;
      },
      open: (userId: number, id: number) => ({ row: { cloneMode }, root: repositories.root(userId, id) })
    };
    const commitAuthors = {
      forRepository: (userId: number, id: number) => {
        repositories.root(userId, id);
        return commitAuthor;
      }
    };
    const engine = new GitEngine(options, new GitRunner());
    const gitMerge = new GitMerge(new LocalGit(new GitRunner()), options);
    const contents = new FileContents(
      {} as OpenableRepository,
      {} as WorkingTreeGuard,
      engine,
      {} as EventsHub,
      {} as DataLayout
    );
    const moduleRef = await Test.createTestingModule({
      controllers: [ GitController ],
      providers: [
        { provide: GitEngine, useValue: engine },
        { provide: WorkingTreeGuard, useValue: new WorkingTreeGuard(new WorkingTreeLock(), engine, gitMerge) },
        { provide: OpenableRepository, useValue: repositories },
        { provide: CommitAuthors, useValue: commitAuthors },
        // Pushing has its own spec, with a remote.
        { provide: PushService, useValue: {} },
        // So is fetching.
        { provide: FetchService, useValue: {} },
        // And pulling.
        { provide: PullService, useValue: {} },
        { provide: GitMerge, useValue: gitMerge },
        { provide: GitBranches, useValue: new GitBranches(new LocalGit(new GitRunner()), gitMerge, options) },
        { provide: MergeStateService, useValue: new MergeStateService(gitMerge, contents) },
        {
          provide: MergeActions,
          useFactory: (guard: MergeGuard, syncState: SyncStateStore, events: EventsHub, state: MergeStateService) =>
            new MergeActions(
              repositories as unknown as OpenableRepository,
              guard,
              gitMerge,
              syncState,
              new MergeRecord(syncState, gitMerge),
              events,
              state,
              contents
            ),
          inject: [ MergeGuard, SyncStateStore, EventsHub, MergeStateService ]
        },
        { provide: MergeGuard, useValue: new MergeGuard(new WorkingTreeLock(), gitMerge) },
        { provide: FetchScheduler, useValue: { fileOpened } },
        {
          provide: SyncStateStore,
          useValue: {
            fetchProblem: () => null,
            record: () => ({ recordedCommit: null, mergeCommit: null, applying: false })
          }
        },
        { provide: GitJobs, useValue: { networkJob: () => null } },
        { provide: EventsHub, useValue: { publish: (_userId: number, event: PushEvent) => published.push(event) } },
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor }
      ]
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    // Stands in for the auth middleware.
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.auth = { userId: USER, sessionId: 'session-1' } as Request['auth'];
      next();
    });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  // Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
  it.skipIf(process.platform === 'win32')('answers only for the owner\'s ready repository', async () => {
    writeFileSync(join(root, 'notes.md'), 'changed\n');

    const ready = await status().expect(200);
    expect(ready.body).toEqual({
      branch: 'main',
      noCommits: false,
      upstream: null,
      upstreamGone: false,
      sameNameRemote: false,
      ahead: 0,
      behind: 0,
      mergeInProgress: false,
      changes: [ { path: 'notes.md', state: 'modified' } ],
      lastCommit: { oid: git(root, 'rev-parse', 'HEAD').trim(), amendable: true, message: 'base' },
      networkJob: null,
      fetchProblem: null
    });

    const cloning = await status(CLONING).expect(409);
    expect(cloning.body).toMatchObject({ code: 'repository-not-openable', params: { status: 'cloning' } });

    const other = await status(9).expect(404);
    expect(other.body).toMatchObject({ code: 'not-found' });
  });

  // Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
  it.skipIf(process.platform === 'win32')(
    'says when an unpublished branch has a remote branch of its name',
    async () => {
      expect((await status().expect(200)).body).toMatchObject({ upstream: null, sameNameRemote: false });

      git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
      expect((await status().expect(200)).body).toMatchObject({ upstream: null, sameNameRemote: true });

      // With an upstream, Pull needs no such branch.
      git(root, 'remote', 'add', 'origin', 'https://git.invalid/handbook.git');
      git(root, 'config', 'branch.main.remote', 'origin');
      git(root, 'config', 'branch.main.merge', 'refs/heads/main');
      expect((await status().expect(200)).body).toMatchObject({ upstream: 'origin/main', sameNameRemote: false });
    }
  );

  // Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
  it.skipIf(process.platform === 'win32')('reports a merge in progress', async () => {
    git(root, 'checkout', '-q', '-b', 'other');
    writeFileSync(join(root, 'notes.md'), 'theirs\n');
    git(root, 'commit', '-q', '-am', 'theirs');
    git(root, 'checkout', '-q', 'main');
    writeFileSync(join(root, 'notes.md'), 'ours\n');
    git(root, 'commit', '-q', '-am', 'ours');
    expect(() => git(root, 'merge', '-q', 'other')).toThrow();

    const { body } = await status().expect(200);
    expect(body).toMatchObject({
      mergeInProgress: true,
      changes: [ { path: 'notes.md', state: 'modified' } ]
    });
  });

  describe('fetch on opening a file', () => {
    const fileOpenedFetch = (id = READY) =>
      request(app.getHttpServer()).post(`/repositories/${id}/git/fetch/file-opened`);

    it('fetches when a file is opened', async () => {
      await fileOpenedFetch().expect(204);

      expect(fileOpened).toHaveBeenCalledWith(USER, 'session-1', READY);
    });

    it('answers another user\'s repository like a missing one', async () => {
      const { body } = await fileOpenedFetch(9).expect(404);

      expect(body).toMatchObject({ code: 'not-found' });
      expect(fileOpened).not.toHaveBeenCalled();
    });

    it('refuses a repository that is not ready', async () => {
      const { body } = await fileOpenedFetch(CLONING).expect(409);

      expect(body).toMatchObject({ code: 'repository-not-openable', params: { status: 'cloning' } });
      expect(fileOpened).not.toHaveBeenCalled();
    });
  });

  describe('diff', () => {
    const diff = (path: string, id = READY) =>
      request(app.getHttpServer()).get(`/repositories/${id}/git/diff`).query({ path });

    // Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
    it.skipIf(process.platform === 'win32')('answers a modified file\'s lines', async () => {
      writeFileSync(join(root, 'notes.md'), 'changed\n');

      const { body } = await diff('notes.md').expect(200);

      expect(body).toEqual({
        kind: 'text',
        lines: [
          { type: 'removed', oldLine: 1, newLine: null, text: 'base' },
          { type: 'added', oldLine: null, newLine: 1, text: 'changed' }
        ],
        complete: true,
        lineEndingsOnly: false
      });
    });

    // Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
    it.skipIf(process.platform === 'win32')('answers the diff of a deleted file', async () => {
      mkdirSync(join(root, 'docs'));
      writeFileSync(join(root, 'docs', 'a.md'), 'a\n');
      git(root, 'add', 'docs');
      git(root, 'commit', '-q', '-m', 'docs');
      rmSync(join(root, 'notes.md'));
      rmSync(join(root, 'docs'), { recursive: true });

      expect((await diff('notes.md').expect(200)).body.lines).toEqual([
        { type: 'removed', oldLine: 1, newLine: null, text: 'base' }
      ]);
      expect((await diff('docs/a.md').expect(200)).body.lines).toEqual([
        { type: 'removed', oldLine: 1, newLine: null, text: 'a' }
      ]);
    });

    // Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
    it.skipIf(process.platform === 'win32')('refuses .git and a path through a symbolic link', async () => {
      const inside = await diff('.git/config').expect(400);
      expect(inside.body).toMatchObject({ code: 'path-refused', params: { reason: 'inside-git' } });

      const outside = mkdtempSync(join(tmpdir(), 'fb-git-outside-'));
      try {
        writeFileSync(join(outside, 'secret.md'), 'secret\n');
        symlinkSync(outside, join(root, 'linked'));
        const through = await diff('linked/secret.md').expect(400);
        expect(through.body).toMatchObject({ code: 'path-refused', params: { reason: 'symlink' } });

        // The link itself is shown as a link: its target's name, not the files behind it.
        const { body } = await diff('linked').expect(200);
        expect(body.lines).toEqual([ { type: 'added', oldLine: null, newLine: 1, text: outside } ]);
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });

    it('answers another user\'s repository like a missing one', async () => {
      const { body } = await diff('notes.md', 9).expect(404);

      expect(body).toMatchObject({ code: 'not-found' });
    });

    it('needs a path', async () => {
      const { body } = await diff('').expect(400);

      expect(body).toMatchObject({ code: 'validation-failed' });
    });
  });

  describe('branches', () => {
    const branches = (id = READY) => request(app.getHttpServer()).get(`/repositories/${id}/git/branches`);

    // Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
    it.skipIf(process.platform === 'win32')('lists the branches and says what kind of clone it is', async () => {
      git(root, 'branch', 'draft');
      git(root, 'update-ref', 'refs/remotes/origin/feature', 'main');

      expect((await branches().expect(200)).body).toEqual({
        current: 'main',
        local: [ { name: 'draft', upstream: null }, { name: 'main', upstream: null } ],
        remote: [ { name: 'origin/feature', branch: 'feature' } ],
        singleBranch: false
      });

      cloneMode = 'single-branch';
      expect((await branches().expect(200)).body).toMatchObject({ singleBranch: true });
    });

    it('answers another user\'s repository like a missing one', async () => {
      expect((await branches(9).expect(404)).body).toMatchObject({ code: 'not-found' });
    });

    it('refuses a repository that is not ready', async () => {
      expect((await branches(CLONING).expect(409)).body).toMatchObject({ code: 'repository-not-openable' });
    });
  });

  // Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
  describe.skipIf(process.platform === 'win32')('switching and creating branches', () => {
    const switchTo = (body: object, id = READY) =>
      request(app.getHttpServer()).post(`/repositories/${id}/git/switch`).send(body);
    const create = (body: object, id = READY) =>
      request(app.getHttpServer()).post(`/repositories/${id}/git/branches`).send(body);
    const current = () => git(root, 'symbolic-ref', '--short', 'HEAD').trim();
    const startMerge = () => {
      git(root, 'checkout', '-q', '-b', 'theirs');
      writeFileSync(join(root, 'notes.md'), 'theirs\n');
      git(root, 'commit', '-q', '-am', 'theirs');
      git(root, 'checkout', '-q', 'main');
      writeFileSync(join(root, 'notes.md'), 'ours\n');
      git(root, 'commit', '-q', '-am', 'ours');
      expect(() => git(root, 'merge', '-q', 'theirs')).toThrow();
    };

    beforeEach(() => {
      git(root, 'branch', 'other');
    });

    it('refuses a switch with uncommitted changes, and nothing changes', async () => {
      writeFileSync(join(root, 'notes.md'), 'changed\n');

      const { body } = await switchTo({ name: 'other', remote: false }).expect(409);

      expect(body).toMatchObject({ code: 'switch-uncommitted-changes' });
      expect(current()).toBe('main');
      expect(readFileSync(join(root, 'notes.md'), 'utf8')).toBe('changed\n');
      expect(published).toEqual([]);
    });

    it('refuses a switch to a remote branch with uncommitted changes, also a new file', async () => {
      git(root, 'config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*');
      git(root, 'update-ref', 'refs/remotes/origin/feature', 'main');
      writeFileSync(join(root, 'new.md'), 'new\n');

      const { body } = await switchTo({ name: 'feature', remote: true }).expect(409);

      expect(body).toMatchObject({ code: 'switch-uncommitted-changes' });
      expect(current()).toBe('main');
      expect(git(root, 'branch', '--list', 'feature')).toBe('');
    });

    it('switches with only ignored files around', async () => {
      writeFileSync(join(root, '.git', 'info', 'exclude'), 'ignored.txt\n');
      writeFileSync(join(root, 'ignored.txt'), 'mine\n');

      await switchTo({ name: 'other', remote: false }).expect(204);

      expect(current()).toBe('other');
      expect(readFileSync(join(root, 'ignored.txt'), 'utf8')).toBe('mine\n');
    });

    it('tracks a remote branch', async () => {
      git(root, 'config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*');
      git(root, 'update-ref', 'refs/remotes/origin/feature', 'main');

      await switchTo({ name: 'feature', remote: true }).expect(204);

      expect(current()).toBe('feature');
      expect(git(root, 'rev-parse', '--abbrev-ref', '@{upstream}').trim()).toBe('origin/feature');
    });

    it('says why a switch did not happen', async () => {
      git(root, 'config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*');
      git(root, 'update-ref', 'refs/remotes/origin/other', 'main');

      expect((await switchTo({ name: 'gone', remote: false }).expect(409)).body.code).toBe('branch-not-found');
      expect((await switchTo({ name: 'gone', remote: true }).expect(409)).body.code).toBe('branch-not-found');
      expect((await switchTo({ name: 'other', remote: true }).expect(409)).body.code).toBe('branch-exists');
      expect((await switchTo({ name: '--orphan=boom', remote: true }).expect(400)).body.code)
        .toBe('branch-name-invalid');
      expect((await switchTo({ name: '--orphan=boom', remote: false }).expect(409)).body.code)
        .toBe('branch-not-found');
      expect(existsSync(join(root, 'notes.md'))).toBe(true);
      expect(current()).toBe('main');
      expect(published).toEqual([]);
    });

    it('refuses both during a merge', async () => {
      startMerge();

      expect((await switchTo({ name: 'other', remote: false }).expect(409)).body.code).toBe('merge-in-progress');
      expect((await create({ name: 'topic' }).expect(409)).body.code).toBe('merge-in-progress');

      expect(current()).toBe('main');
      expect(git(root, 'branch', '--list', 'topic')).toBe('');
      expect(published).toEqual([]);
    });

    it('creates a branch, with uncommitted changes too', async () => {
      writeFileSync(join(root, 'notes.md'), 'changed\n');

      await create({ name: 'topic' }).expect(204);

      expect(current()).toBe('topic');
      expect(readFileSync(join(root, 'notes.md'), 'utf8')).toBe('changed\n');
    });

    it('says why a name was refused', async () => {
      expect((await create({ name: 'bad..name' }).expect(400)).body.code).toBe('branch-name-invalid');
      expect((await create({ name: 'other' }).expect(409)).body.code).toBe('branch-exists');
      expect((await create({ name: 'other/topic' }).expect(409)).body.code).toBe('branch-name-conflict');
      expect(current()).toBe('main');
      expect(published).toEqual([]);
    });

    it('refuses a new branch without commits', async () => {
      const empty = mkdtempSync(join(tmpdir(), 'fb-git-controller-empty-'));
      git(empty, 'init', '-q', '-b', 'main');
      const filled = root;
      root = empty;
      try {
        expect((await create({ name: 'topic' }).expect(409)).body.code).toBe('no-commits');
      } finally {
        root = filled;
        rmSync(empty, { recursive: true, force: true });
      }
    });

    it('publishes files.changed and git.changed after a switch', async () => {
      await switchTo({ name: 'other', remote: false }).expect(204);

      expect(published).toEqual([
        { type: 'files.changed', repositoryId: READY, folders: 'all' },
        { type: 'git.changed', repositoryId: READY }
      ]);
    });

    it('publishes only git.changed for a new branch', async () => {
      await create({ name: 'topic' }).expect(204);

      expect(published).toEqual([ { type: 'git.changed', repositoryId: READY } ]);
    });

    it('tells clients after a switch that ran out of time, as files may have changed', async () => {
      vi.spyOn(app.get(GitBranches), 'switchTo').mockRejectedValue(new GitOperationError('timeout', ''));

      expect((await switchTo({ name: 'other', remote: false }).expect(504)).body.code).toBe('git-timeout');

      expect(published).toEqual([
        { type: 'files.changed', repositoryId: READY, folders: 'all' },
        { type: 'git.changed', repositoryId: READY }
      ]);
    });

    it('tells clients after a tracking switch that ran out of time', async () => {
      vi.spyOn(app.get(GitBranches), 'trackRemote').mockRejectedValue(new GitOperationError('timeout', ''));

      await switchTo({ name: 'feature', remote: true }).expect(504);

      expect(published).toEqual([
        { type: 'files.changed', repositoryId: READY, folders: 'all' },
        { type: 'git.changed', repositoryId: READY }
      ]);
    });

    it('tells clients after a new branch that ran out of time, as it may be current', async () => {
      vi.spyOn(app.get(GitBranches), 'create').mockRejectedValue(new GitOperationError('timeout', ''));

      await create({ name: 'topic' }).expect(504);

      expect(published).toEqual([ { type: 'git.changed', repositoryId: READY } ]);
    });

    it('does not read the status to create a branch, which a large working copy would make slow', async () => {
      const status = vi.spyOn(app.get(GitEngine), 'status');

      await create({ name: 'topic' }).expect(204);

      expect(status).not.toHaveBeenCalled();
    });

    it('leaves a switch to a clashing remote branch without any change', async () => {
      git(root, 'config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*');
      git(root, 'checkout', '-q', '-b', 'published');
      writeFileSync(join(root, 'notes.md'), 'published\n');
      git(root, 'commit', '-q', '-am', 'published');
      git(root, 'checkout', '-q', 'main');
      git(root, 'update-ref', 'refs/remotes/origin/other/topic', 'published');

      expect((await switchTo({ name: 'other/topic', remote: true }).expect(409)).body.code)
        .toBe('branch-name-conflict');

      expect(git(root, 'status', '--porcelain')).toBe('');
      expect(published).toEqual([]);
    });

    it('answers another user\'s repository like a missing one', async () => {
      expect((await switchTo({ name: 'other', remote: false }, 9).expect(404)).body.code).toBe('not-found');
      expect((await create({ name: 'topic' }, 9).expect(404)).body.code).toBe('not-found');
    });

    it('refuses a repository that is not ready', async () => {
      expect((await switchTo({ name: 'other', remote: false }, CLONING).expect(409)).body.code)
        .toBe('repository-not-openable');
      expect((await create({ name: 'topic' }, CLONING).expect(409)).body.code).toBe('repository-not-openable');
    });

    it('needs the request\'s fields', async () => {
      await switchTo({ name: 'other' }).expect(400);
      await create({}).expect(400);
    });
  });

  describe('incoming', () => {
    const incoming = (path: string, id = READY) =>
      request(app.getHttpServer()).get(`/repositories/${id}/git/incoming`).query({ path });

    beforeEach(() => {
      // An upstream with one commit that changes notes.md, as after a fetch.
      git(root, 'checkout', '-q', '-b', 'theirs');
      writeFileSync(join(root, 'notes.md'), 'theirs\n');
      git(root, 'commit', '-q', '-am', 'theirs');
      git(root, 'update-ref', 'refs/remotes/origin/main', 'theirs');
      git(root, 'checkout', '-q', 'main');
      git(root, 'config', 'branch.main.remote', 'origin');
      git(root, 'config', 'branch.main.merge', 'refs/heads/main');
    });

    // Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
    it.skipIf(process.platform === 'win32')('refuses a path inside .git', async () => {
      const inside = await incoming('.git/config').expect(400);
      expect(inside.body).toMatchObject({ code: 'path-refused', params: { reason: 'inside-git' } });

      const outside = mkdtempSync(join(tmpdir(), 'fb-git-outside-'));
      try {
        symlinkSync(outside, join(root, 'linked'));
        const through = await incoming('linked/secret.md').expect(400);
        expect(through.body).toMatchObject({ code: 'path-refused', params: { reason: 'symlink' } });
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }

      expect((await incoming('../notes.md').expect(400)).body).toMatchObject({ code: 'path-refused' });
    });

    // Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
    it.skipIf(process.platform === 'win32')('reads a path that looks like a pathspec literally', async () => {
      expect((await incoming('notes.md').expect(200)).body).toEqual({
        incoming: { upstream: 'origin/main', commits: 1, touchesPath: true }
      });
      // As pathspecs, both would match notes.md.
      for (const path of [ ':(glob)*.md', '*.md' ]) {
        expect((await incoming(path).expect(200)).body).toEqual({
          incoming: { upstream: 'origin/main', commits: 1, touchesPath: false }
        });
      }
    });

    it('answers another user\'s repository like a missing one', async () => {
      expect((await incoming('notes.md', 9).expect(404)).body).toMatchObject({ code: 'not-found' });
    });
  });

  describe('merge', () => {
    const mergeState = (id = READY) => request(app.getHttpServer()).get(`/repositories/${id}/git/merge`);

    it('reads a merge in progress', async () => {
      git(root, 'switch', '-q', '-c', 'theirs');
      writeFileSync(join(root, 'notes.md'), 'theirs\n');
      git(root, 'commit', '-q', '-am', 'theirs');
      git(root, 'switch', '-q', 'main');
      writeFileSync(join(root, 'notes.md'), 'mine\n');
      git(root, 'commit', '-q', '-am', 'mine');
      expect(() => git(root, 'merge', '--no-edit', 'theirs')).toThrow();

      const response = await mergeState().expect(200);

      expect(response.body).toEqual({
        into: 'main',
        from: 'MERGE_HEAD',
        files: [
          {
            path: 'notes.md',
            kind: 'both-changed',
            resolved: false,
            edited: false,
            editable: true,
            oursSize: 5,
            theirsSize: 7
          }
        ],
        otherFiles: [],
        message: 'Merge branch \'theirs\''
      });
    });

    it('answers no merge and another user\'s repository', async () => {
      const response = await mergeState().expect(409);
      expect(response.body.code).toBe('no-merge-in-progress');

      await mergeState(99).expect(404);
    });

    it('refuses a repository that is not ready', async () => {
      await mergeState(CLONING).expect(409);
    });

    describe('version', () => {
      const mergeVersion = (path: string, side: string, id = READY) =>
        request(app.getHttpServer()).get(`/repositories/${id}/git/merge/version`).query({ path, side });

      it('reads my version and their version', async () => {
        git(root, 'switch', '-q', '-c', 'theirs');
        writeFileSync(join(root, 'notes.md'), 'theirs\n');
        git(root, 'commit', '-q', '-am', 'theirs');
        git(root, 'switch', '-q', 'main');
        writeFileSync(join(root, 'notes.md'), 'mine\n');
        git(root, 'commit', '-q', '-am', 'mine');
        expect(() => git(root, 'merge', '--no-edit', 'theirs')).toThrow();

        const ours = await mergeVersion('notes.md', 'ours').expect(200);
        expect(ours.body).toEqual({ content: 'mine\n' });

        const theirs = await mergeVersion('notes.md', 'theirs').expect(200);
        expect(theirs.body).toEqual({ content: 'theirs\n' });
      });

      it('reads a version of a resolved file', async () => {
        git(root, 'switch', '-q', '-c', 'theirs');
        writeFileSync(join(root, 'notes.md'), 'theirs\n');
        git(root, 'commit', '-q', '-am', 'theirs');
        git(root, 'switch', '-q', 'main');
        writeFileSync(join(root, 'notes.md'), 'mine\n');
        git(root, 'commit', '-q', '-am', 'mine');
        expect(() => git(root, 'merge', '--no-edit', 'theirs')).toThrow();
        writeFileSync(join(root, 'notes.md'), 'resolved\n');
        git(root, 'add', 'notes.md');

        const { body } = await mergeVersion('notes.md', 'ours').expect(200);

        expect(body).toEqual({ content: 'mine\n' });
      });

      it('refuses a path that is not conflicting', async () => {
        git(root, 'switch', '-q', '-c', 'theirs');
        writeFileSync(join(root, 'notes.md'), 'theirs\n');
        git(root, 'commit', '-q', '-am', 'theirs');
        git(root, 'switch', '-q', 'main');
        writeFileSync(join(root, 'notes.md'), 'mine\n');
        git(root, 'commit', '-q', '-am', 'mine');
        expect(() => git(root, 'merge', '--no-edit', 'theirs')).toThrow();

        const { body } = await mergeVersion('.git/config', 'ours').expect(409);

        expect(body).toMatchObject({ code: 'not-conflicting' });
      });

      it('refuses a large version without reading it', async () => {
        const large = (fill: string) => `${fill.repeat(1_048_577)}\n`;
        git(root, 'switch', '-q', '-c', 'theirs');
        writeFileSync(join(root, 'large.md'), 'theirs\n');
        git(root, 'add', 'large.md');
        git(root, 'commit', '-q', '-m', 'theirs');
        git(root, 'switch', '-q', 'main');
        writeFileSync(join(root, 'large.md'), large('m'));
        git(root, 'add', 'large.md');
        git(root, 'commit', '-q', '-m', 'mine');
        expect(() => git(root, 'merge', '--no-edit', 'theirs')).toThrow();

        const { body } = await mergeVersion('large.md', 'ours').expect(409);

        expect(body).toMatchObject({ code: 'version-not-readable' });
      });

      it('refuses a version that is not valid UTF-8', async () => {
        git(root, 'switch', '-q', '-c', 'theirs');
        writeFileSync(join(root, 'latin.md'), 'theirs\n');
        git(root, 'add', 'latin.md');
        git(root, 'commit', '-q', '-m', 'theirs');
        git(root, 'switch', '-q', 'main');
        writeFileSync(join(root, 'latin.md'), Buffer.from([ 0x6d, 0xe9, 0x0a ]));
        git(root, 'add', 'latin.md');
        git(root, 'commit', '-q', '-m', 'mine');
        expect(() => git(root, 'merge', '--no-edit', 'theirs')).toThrow();

        const { body } = await mergeVersion('latin.md', 'ours').expect(409);

        expect(body).toMatchObject({ code: 'version-not-readable' });
      });

      it('refuses a non-Markdown file with version-not-readable', async () => {
        git(root, 'switch', '-q', '-c', 'theirs');
        writeFileSync(join(root, 'config.env'), 'BASE=3\n');
        git(root, 'add', 'config.env');
        git(root, 'commit', '-q', '-m', 'theirs');
        git(root, 'switch', '-q', 'main');
        writeFileSync(join(root, 'config.env'), 'BASE=2\n');
        git(root, 'add', 'config.env');
        git(root, 'commit', '-q', '-m', 'mine');
        expect(() => git(root, 'merge', '--no-edit', 'theirs')).toThrow();

        const { body } = await mergeVersion('config.env', 'ours').expect(409);

        expect(body).toMatchObject({ code: 'version-not-readable' });
      });

      it('refuses a symbolic link with version-not-readable', async () => {
        writeFileSync(join(root, 'base.txt'), 'base\n');
        symlinkSync('base.txt', join(root, 'link.md'));
        git(root, 'add', 'link.md');
        git(root, 'commit', '-q', '-m', 'base');
        git(root, 'switch', '-q', '-c', 'theirs');
        writeFileSync(join(root, 'theirs.txt'), 'theirs\n');
        rmSync(join(root, 'link.md'));
        symlinkSync('theirs.txt', join(root, 'link.md'));
        git(root, 'add', 'link.md');
        git(root, 'commit', '-q', '-m', 'theirs');
        git(root, 'switch', '-q', 'main');
        writeFileSync(join(root, 'mine.txt'), 'mine\n');
        rmSync(join(root, 'link.md'));
        symlinkSync('mine.txt', join(root, 'link.md'));
        git(root, 'add', 'link.md');
        git(root, 'commit', '-q', '-m', 'mine');
        expect(() => git(root, 'merge', '--no-edit', 'theirs')).toThrow();

        const { body } = await mergeVersion('link.md', 'ours').expect(409);

        expect(body).toMatchObject({ code: 'version-not-readable' });
      });

      it('refuses the side that deleted the file', async () => {
        writeFileSync(join(root, 'gone.md'), 'x\n');
        git(root, 'add', 'gone.md');
        git(root, 'commit', '-q', '-m', 'base');
        git(root, 'switch', '-q', '-c', 'theirs');
        git(root, 'rm', '-q', 'gone.md');
        git(root, 'commit', '-q', '-m', 'theirs');
        git(root, 'switch', '-q', 'main');
        writeFileSync(join(root, 'gone.md'), 'x changed\n');
        git(root, 'commit', '-q', '-am', 'mine');
        expect(() => git(root, 'merge', '--no-edit', 'theirs')).toThrow();

        const { body } = await mergeVersion('gone.md', 'theirs').expect(409);

        expect(body).toMatchObject({ code: 'version-not-readable' });
      });

      it('refuses without a merge', async () => {
        const { body } = await mergeVersion('notes.md', 'ours').expect(409);

        expect(body).toMatchObject({ code: 'no-merge-in-progress' });
      });

      it('answers another user\'s repository like a missing one', async () => {
        await mergeVersion('notes.md', 'ours', 9).expect(404);
      });

      it('needs the side parameter', async () => {
        await mergeVersion('notes.md', '').expect(400);
      });

      it('refuses an empty path', async () => {
        const { body } = await mergeVersion('', 'ours').expect(400);

        expect(body).toMatchObject({ code: 'validation-failed' });
      });

      it('strips a BOM from the returned content', async () => {
        const BOM = Buffer.from([ 0xef, 0xbb, 0xbf ]);
        git(root, 'switch', '-q', '-c', 'theirs');
        writeFileSync(join(root, 'notes.md'), 'theirs\n');
        git(root, 'commit', '-q', '-am', 'theirs');
        git(root, 'switch', '-q', 'main');
        writeFileSync(join(root, 'notes.md'), Buffer.concat([ BOM, Buffer.from('mine\n') ]));
        git(root, 'commit', '-q', '-am', 'mine');
        expect(() => git(root, 'merge', '--no-edit', 'theirs')).toThrow();

        const { body } = await mergeVersion('notes.md', 'ours').expect(200);

        expect(body).toEqual({ content: 'mine\n' });
      });

      it('converts CRLF to LF in the returned content', async () => {
        git(root, 'switch', '-q', '-c', 'theirs');
        writeFileSync(join(root, 'notes.md'), 'theirs\n');
        git(root, 'commit', '-q', '-am', 'theirs');
        git(root, 'switch', '-q', 'main');
        writeFileSync(join(root, 'notes.md'), Buffer.from('line one\r\nline two\r\n'));
        git(root, 'commit', '-q', '-am', 'mine');
        expect(() => git(root, 'merge', '--no-edit', 'theirs')).toThrow();

        const { body } = await mergeVersion('notes.md', 'ours').expect(200);

        expect(body).toEqual({ content: 'line one\nline two\n' });
      });

      it('accepts a file containing U+FFFD', async () => {
        git(root, 'switch', '-q', '-c', 'theirs');
        writeFileSync(join(root, 'notes.md'), 'theirs\n');
        git(root, 'commit', '-q', '-am', 'theirs');
        git(root, 'switch', '-q', 'main');
        writeFileSync(join(root, 'notes.md'), Buffer.from('replaced \ufffd char\n'));
        git(root, 'commit', '-q', '-am', 'mine');
        expect(() => git(root, 'merge', '--no-edit', 'theirs')).toThrow();

        const { body } = await mergeVersion('notes.md', 'ours').expect(200);

        expect(body).toEqual({ content: 'replaced \ufffd char\n' });
      });
    });

    describe('abort', () => {
      const abort = (id = READY) => request(app.getHttpServer()).post(`/repositories/${id}/git/merge/abort`);

      it('ends the merge and tells clients', async () => {
        git(root, 'switch', '-q', '-c', 'theirs');
        writeFileSync(join(root, 'notes.md'), 'theirs\n');
        git(root, 'commit', '-q', '-am', 'theirs');
        git(root, 'switch', '-q', 'main');
        writeFileSync(join(root, 'notes.md'), 'mine\n');
        git(root, 'commit', '-q', '-am', 'mine');
        expect(() => git(root, 'merge', '--no-edit', 'theirs')).toThrow();

        await abort().expect(204);

        expect(readFileSync(join(root, 'notes.md'), 'utf8')).toBe('mine\n');
        expect(git(root, 'status', '--porcelain')).toBe('');
        expect((await mergeState().expect(409)).body.code).toBe('no-merge-in-progress');
        expect(published).toEqual([
          { type: 'files.changed', repositoryId: READY, folders: 'all' },
          { type: 'git.changed', repositoryId: READY }
        ]);
      });

      it('answers no merge, and another user\'s repository like a missing one', async () => {
        expect((await abort().expect(409)).body.code).toBe('no-merge-in-progress');
        await abort(99).expect(404);
        await abort(CLONING).expect(409);
        expect(published).toEqual([]);
      });
    });
  });

  // Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
  describe.skipIf(process.platform === 'win32')('resolve', () => {
    const resolveConflict = (body: object, id = READY) =>
      request(app.getHttpServer()).post(`/repositories/${id}/git/merge/resolve`).send(body);
    const mergeState = () => request(app.getHttpServer()).get(`/repositories/${READY}/git/merge`);

    beforeEach(() => {
      git(root, 'switch', '-q', '-c', 'theirs');
      writeFileSync(join(root, 'notes.md'), 'theirs\n');
      git(root, 'commit', '-q', '-am', 'theirs');
      git(root, 'switch', '-q', 'main');
      writeFileSync(join(root, 'notes.md'), 'mine\n');
      git(root, 'commit', '-q', '-am', 'mine');
      expect(() => git(root, 'merge', '--no-edit', 'theirs')).toThrow();
    });

    it('resolves a file with a whole version and tells clients', async () => {
      await resolveConflict({ path: 'notes.md', resolution: 'theirs' }).expect(204);

      expect(readFileSync(join(root, 'notes.md'), 'utf8')).toBe('theirs\n');
      const { body } = await mergeState().expect(200);
      expect(body.files).toMatchObject([ { path: 'notes.md', resolved: true } ]);
      expect(published).toEqual([
        { type: 'files.changed', repositoryId: READY, folders: [ '' ] },
        { type: 'git.changed', repositoryId: READY }
      ]);
    });

    it('refuses leftover markers without force, and goes ahead with it', async () => {
      const left = await resolveConflict({ path: 'notes.md', resolution: 'mark-resolved' }).expect(409);
      expect(left.body).toMatchObject({ code: 'conflict-markers-left' });

      await resolveConflict({ path: 'notes.md', resolution: 'mark-resolved', force: true }).expect(204);
    });

    it('refuses what the merge does not allow', async () => {
      const kind = await resolveConflict({ path: 'notes.md', resolution: 'keep' }).expect(409);
      expect(kind.body).toMatchObject({ code: 'resolution-not-allowed' });
      const other = await resolveConflict({ path: 'other.md', resolution: 'ours' }).expect(409);
      expect(other.body).toMatchObject({ code: 'not-conflicting' });
      const inside = await resolveConflict({ path: '.git/config', resolution: 'ours' }).expect(409);
      expect(inside.body).toMatchObject({ code: 'not-conflicting' });
      expect(published).toEqual([]);
    });

    it('validates the request', async () => {
      for (const body of [ { path: 'notes.md', resolution: 'both' }, { path: '', resolution: 'ours' }, {} ]) {
        expect((await resolveConflict(body).expect(400)).body).toMatchObject({ code: 'validation-failed' });
      }
    });

    it('answers no merge, and another user\'s repository like a missing one', async () => {
      git(root, 'merge', '--abort');

      const none = await resolveConflict({ path: 'notes.md', resolution: 'ours' }).expect(409);
      expect(none.body).toMatchObject({ code: 'no-merge-in-progress' });
      await resolveConflict({ path: 'notes.md', resolution: 'ours' }, 99).expect(404);
    });

    describe('start over', () => {
      const startOver = (body: object, id = READY) =>
        request(app.getHttpServer()).post(`/repositories/${id}/git/merge/start-over`).send(body);

      it('brings back the markers, says the file was edited before, and tells clients', async () => {
        writeFileSync(join(root, 'notes.md'), 'both\n');
        await resolveConflict({ path: 'notes.md', resolution: 'mark-resolved' }).expect(204);
        expect((await mergeState().expect(200)).body.files).toMatchObject([
          { path: 'notes.md', resolved: true, edited: true }
        ]);
        published.length = 0;

        await startOver({ path: 'notes.md' }).expect(204);

        expect(readFileSync(join(root, 'notes.md'), 'utf8')).toBe(
          '<<<<<<< main\nmine\n=======\ntheirs\n>>>>>>> MERGE_HEAD\n'
        );
        expect((await mergeState().expect(200)).body.files).toMatchObject([
          { path: 'notes.md', resolved: false, edited: false }
        ]);
        expect(published).toEqual([
          { type: 'files.changed', repositoryId: READY, folders: [ '' ] },
          { type: 'git.changed', repositoryId: READY }
        ]);
      });

      it('refuses a file that is not resolved, or not in the merge', async () => {
        const unresolved = await startOver({ path: 'notes.md' }).expect(409);
        expect(unresolved.body).toMatchObject({ code: 'not-resolved' });
        const other = await startOver({ path: 'other.md' }).expect(409);
        expect(other.body).toMatchObject({ code: 'not-conflicting' });
        expect(published).toEqual([]);
      });

      it('validates the request', async () => {
        for (const body of [ { path: '' }, {} ]) {
          expect((await startOver(body).expect(400)).body).toMatchObject({ code: 'validation-failed' });
        }
      });

      it('answers no merge, and another user\'s repository like a missing one', async () => {
        git(root, 'merge', '--abort');

        expect((await startOver({ path: 'notes.md' }).expect(409)).body).toMatchObject({
          code: 'no-merge-in-progress'
        });
        await startOver({ path: 'notes.md' }, 99).expect(404);
      });
    });
  });

  describe('discard', () => {
    // Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
    it.skipIf(process.platform === 'win32')('discards a modified, an added and a deleted file', async () => {
      writeFileSync(join(root, 'gone.md'), 'gone\n');
      git(root, 'add', 'gone.md');
      git(root, 'commit', '-q', '-m', 'gone');
      writeFileSync(join(root, 'notes.md'), 'changed\n');
      writeFileSync(join(root, 'new.md'), 'new\n');
      rmSync(join(root, 'gone.md'));

      await discard({ paths: [ 'notes.md', 'new.md', 'gone.md' ] }).expect(204);

      expect(readFileSync(join(root, 'notes.md'), 'utf8')).toBe('base\n');
      expect(existsSync(join(root, 'new.md'))).toBe(false);
      expect(readFileSync(join(root, 'gone.md'), 'utf8')).toBe('gone\n');
      expect(git(root, 'status', '--porcelain').trim()).toBe('');
    });

    it('refuses .git and a path through a symbolic link, and discards nothing', async () => {
      writeFileSync(join(root, 'notes.md'), 'changed\n');
      const config = readFileSync(join(root, '.git', 'config'), 'utf8');

      const inside = await discard({ paths: [ 'notes.md', '.git/config' ] }).expect(400);
      expect(inside.body).toMatchObject({ code: 'path-refused', params: { reason: 'inside-git' } });

      const outside = mkdtempSync(join(tmpdir(), 'fb-git-outside-'));
      try {
        writeFileSync(join(outside, 'secret.md'), 'secret\n');
        symlinkSync(outside, join(root, 'linked'));
        const through = await discard({ paths: [ 'notes.md', 'linked/secret.md' ] }).expect(400);
        expect(through.body).toMatchObject({ code: 'path-refused', params: { reason: 'symlink' } });
        expect(readFileSync(join(outside, 'secret.md'), 'utf8')).toBe('secret\n');
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
      expect(readFileSync(join(root, 'notes.md'), 'utf8')).toBe('changed\n');
      expect(readFileSync(join(root, '.git', 'config'), 'utf8')).toBe(config);
      expect(published).toEqual([]);
    });

    it('refuses a discard during a merge', async () => {
      git(root, 'checkout', '-q', '-b', 'theirs');
      writeFileSync(join(root, 'notes.md'), 'theirs\n');
      git(root, 'commit', '-q', '-am', 'theirs');
      git(root, 'checkout', '-q', 'main');
      writeFileSync(join(root, 'notes.md'), 'ours\n');
      git(root, 'commit', '-q', '-am', 'ours');
      expect(() => git(root, 'merge', '-q', 'theirs')).toThrow();
      const conflicted = readFileSync(join(root, 'notes.md'), 'utf8');

      const { body } = await discard({ paths: [ 'notes.md' ] }).expect(409);

      expect(body).toMatchObject({ code: 'merge-in-progress' });
      expect(readFileSync(join(root, 'notes.md'), 'utf8')).toBe(conflicted);
      expect(published).toEqual([]);
    });

    // Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
    it.skipIf(process.platform === 'win32')('refuses to replace a file that is not being discarded', async () => {
      rmSync(join(root, 'notes.md'));
      mkdirSync(join(root, 'notes.md'));
      writeFileSync(join(root, 'notes.md', 'keep.md'), 'keep\n');

      const { body } = await discard({ paths: [ 'notes.md' ] }).expect(409);

      expect(body).toMatchObject({ code: 'discard-blocked' });
      expect(readFileSync(join(root, 'notes.md', 'keep.md'), 'utf8')).toBe('keep\n');
      expect(published).toEqual([]);
    });

    it('answers another user\'s repository like a missing one', async () => {
      const { body } = await discard({ paths: [ 'notes.md' ] }, 9).expect(404);

      expect(body).toMatchObject({ code: 'not-found' });
    });

    // Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
    it.skipIf(process.platform === 'win32')('publishes files.changed and git.changed', async () => {
      writeFileSync(join(root, 'notes.md'), 'changed\n');

      await discard({ paths: [ 'notes.md' ] }).expect(204);

      expect(published).toEqual([
        { type: 'files.changed', repositoryId: READY, folders: 'all' },
        { type: 'git.changed', repositoryId: READY }
      ]);
    });

    // Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
    it.skipIf(process.platform === 'win32')(
      'publishes the events also when it fails after changing files',
      async () => {
        writeFileSync(join(root, 'notes.md'), 'changed\n');
        writeFileSync(join(root, 'new.md'), 'new\n');
        // Another git at work: the added file goes, then the index cannot be written.
        writeFileSync(join(root, '.git', 'index.lock'), '');

        await discard({ paths: [ 'notes.md', 'new.md' ] }).expect(500);

        expect(existsSync(join(root, 'new.md'))).toBe(false);
        expect(published).toEqual([
          { type: 'files.changed', repositoryId: READY, folders: 'all' },
          { type: 'git.changed', repositoryId: READY }
        ]);
      }
    );

    // Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
    it.skipIf(process.platform === 'win32')('publishes nothing when no path was a change', async () => {
      await discard({ paths: [ 'notes.md' ] }).expect(204);

      expect(published).toEqual([]);
    });

    // Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
    it.skipIf(process.platform === 'win32')('skips a name too long to exist', async () => {
      await discard({ paths: [ 'a'.repeat(300) ] }).expect(204);
    });

    // Only Linux keeps a file name's bytes as they are.
    it.runIf(process.platform === 'linux')('refuses a name that is not valid UTF-8', async () => {
      writeFileSync(Buffer.concat([ Buffer.from(`${root}/caf`), Buffer.from([ 0xe9 ]), Buffer.from('.md') ]), 'x\n');
      const { body: listed } = await status().expect(200);
      const mangled = (listed as GitStatus).changes[0].path;

      const { body } = await discard({ paths: [ mangled ] }).expect(400);

      expect(body).toMatchObject({ code: 'path-refused', params: { reason: 'malformed' } });
    });

    // Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
    it.skipIf(process.platform === 'win32')(
      'restores a file whose folder a new symbolic link replaced, when the link goes too',
      async () => {
        mkdirSync(join(root, 'docs'));
        writeFileSync(join(root, 'docs', 'a.md'), 'a\n');
        git(root, 'add', 'docs');
        git(root, 'commit', '-q', '-m', 'docs');
        rmSync(join(root, 'docs'), { recursive: true });
        const outside = mkdtempSync(join(tmpdir(), 'fb-git-outside-'));
        try {
          writeFileSync(join(outside, 'a.md'), 'outside\n');
          symlinkSync(outside, join(root, 'docs'));

          await discard({ paths: [ 'docs', 'docs/a.md' ] }).expect(204);

          expect(readFileSync(join(root, 'docs', 'a.md'), 'utf8')).toBe('a\n');
          expect(readFileSync(join(outside, 'a.md'), 'utf8')).toBe('outside\n');
        } finally {
          rmSync(outside, { recursive: true, force: true });
        }
      }
    );

    // Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
    it.skipIf(process.platform === 'win32')('touches nothing behind a listed symbolic link', async () => {
      const outside = mkdtempSync(join(tmpdir(), 'fb-git-outside-'));
      try {
        writeFileSync(join(outside, 'secret.md'), 'secret\n');
        symlinkSync(outside, join(root, 'linked'));

        await discard({ paths: [ 'linked', 'linked/secret.md' ] }).expect(204);

        expect(lstatSync(join(root, 'linked'), { throwIfNoEntry: false })).toBeUndefined();
        expect(readFileSync(join(outside, 'secret.md'), 'utf8')).toBe('secret\n');
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });

    it('still refuses a path through a symbolic link that only shares a folder with a listed path', async () => {
      const outside = mkdtempSync(join(tmpdir(), 'fb-git-outside-'));
      try {
        writeFileSync(join(outside, 'secret.md'), 'secret\n');
        symlinkSync(outside, join(root, 'linked'));

        const { body } = await discard({ paths: [ 'other', 'linked/secret.md' ] }).expect(400);

        expect(body).toMatchObject({ code: 'path-refused', params: { reason: 'symlink' } });
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });

    it('refuses an empty list', async () => {
      const { body } = await discard({ paths: [] }).expect(400);

      expect(body).toMatchObject({ code: 'validation-failed' });
    });
  });

  describe('commits', () => {
    beforeEach(() => {
      writeFileSync(join(root, 'notes.md'), 'changed\n');
      writeFileSync(join(root, 'other.md'), 'other\n');
    });

    // Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
    it.skipIf(process.platform === 'win32')('commits the listed changes as the commit author', async () => {
      const { body } = await commit({ message: 'Update the notes', paths: [ 'notes.md' ] }).expect(201);

      expect(body).toEqual({ oid: git(root, 'rev-parse', 'HEAD').trim() });
      expect(git(root, 'log', '-1', '--format=%s').trim()).toBe('Update the notes');
      expect(authorOf()).toBe('Ada Lovelace <ada@example.com> / Ada Lovelace <ada@example.com>');
      expect(git(root, 'status', '--porcelain').trim()).toBe('?? other.md');
    });

    it('refuses a commit from a user who has not confirmed', async () => {
      commitAuthor = { ...commitAuthor, confirmed: false };
      const head = git(root, 'rev-parse', 'HEAD');

      const { body } = await commit({ message: 'Update', paths: [ 'notes.md' ] }).expect(409);

      expect(body).toMatchObject({ code: 'commit-author-not-confirmed' });
      expect(git(root, 'rev-parse', 'HEAD')).toBe(head);
    });

    // Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
    it.skipIf(process.platform === 'win32')(
      'AC-GIT-001.8: changing the default does not change commits already made',
      async () => {
        await commit({ message: 'First', paths: [ 'notes.md' ] }).expect(201);
        commitAuthor = { ...commitAuthor, author: { name: 'Ada King', email: 'king@example.com' } };

        await commit({ message: 'Second', paths: [ 'other.md' ] }).expect(201);

        expect(authorOf('HEAD~1')).toBe('Ada Lovelace <ada@example.com> / Ada Lovelace <ada@example.com>');
        expect(authorOf()).toBe('Ada King <king@example.com> / Ada King <king@example.com>');
      }
    );

    // Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
    it.skipIf(process.platform === 'win32')('uses the repository\'s override', async () => {
      commitAuthor = { author: { name: 'Work Ada', email: 'ada@work.example' }, source: 'override', confirmed: true };

      await commit({ message: 'Update', paths: [ 'notes.md' ] }).expect(201);

      expect(authorOf()).toBe('Work Ada <ada@work.example> / Work Ada <ada@work.example>');
    });

    it('refuses an empty message and an empty list', async () => {
      const empty = await commit({ message: ' \n ', paths: [ 'notes.md' ] }).expect(400);
      expect(empty.body).toMatchObject({ code: 'validation-failed' });

      const none = await commit({ message: 'Update', paths: [] }).expect(400);
      expect(none.body).toMatchObject({ code: 'validation-failed' });
    });

    it('refuses .git and a path through a symbolic link', async () => {
      const inside = await commit({ message: 'Update', paths: [ 'notes.md', '.git/config' ] }).expect(400);
      expect(inside.body).toMatchObject({ code: 'path-refused', params: { reason: 'inside-git' } });

      const outside = mkdtempSync(join(tmpdir(), 'fb-git-outside-'));
      try {
        writeFileSync(join(outside, 'secret.md'), 'secret\n');
        symlinkSync(outside, join(root, 'linked'));
        const through = await commit({ message: 'Update', paths: [ 'linked/secret.md' ] }).expect(400);
        expect(through.body).toMatchObject({ code: 'path-refused', params: { reason: 'symlink' } });
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
      expect(git(root, 'log', '--format=%s').trim()).toBe('base');
    });

    // Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
    it.skipIf(process.platform === 'win32')('commits a file of a deleted folder', async () => {
      mkdirSync(join(root, 'docs'));
      writeFileSync(join(root, 'docs', 'a.md'), 'a\n');
      git(root, 'add', 'docs');
      git(root, 'commit', '-q', '-m', 'docs');
      rmSync(join(root, 'docs'), { recursive: true });

      await commit({ message: 'Remove docs', paths: [ 'docs/a.md' ] }).expect(201);

      expect(git(root, 'show', '--name-status', '--format=', 'HEAD').trim()).toBe('D\tdocs/a.md');
    });

    it('refuses a commit during a merge', async () => {
      git(root, 'stash', '-q', '-u');
      git(root, 'checkout', '-q', '-b', 'theirs');
      writeFileSync(join(root, 'notes.md'), 'theirs\n');
      git(root, 'commit', '-q', '-am', 'theirs');
      git(root, 'checkout', '-q', 'main');
      writeFileSync(join(root, 'notes.md'), 'ours\n');
      git(root, 'commit', '-q', '-am', 'ours');
      expect(() => git(root, 'merge', '-q', 'theirs')).toThrow();

      const { body } = await commit({ message: 'Update', paths: [ 'notes.md' ] }).expect(409);

      expect(body).toMatchObject({ code: 'merge-in-progress' });
    });

    // Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
    it.skipIf(process.platform === 'win32')('refuses a commit on a detached HEAD', async () => {
      git(root, 'checkout', '-q', '--detach');

      const { body } = await commit({ message: 'Update', paths: [ 'notes.md' ] }).expect(409);

      expect(body).toMatchObject({ code: 'detached-head' });
      expect(git(root, 'log', '--format=%s').trim()).toBe('base');
    });

    // Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
    it.skipIf(process.platform === 'win32')('a repeated request answers nothing-to-commit', async () => {
      const sent = { message: 'Update', paths: [ 'notes.md' ] };

      const [ first, second ] = await Promise.all([ commit(sent), commit(sent) ]);

      expect([ first.status, second.status ].sort()).toEqual([ 201, 409 ]);
      expect([ first, second ].find(response => response.status === 409)?.body).toMatchObject({
        code: 'nothing-to-commit'
      });
      expect(git(root, 'log', '--format=%s').trim()).toBe('Update\nbase');
    });

    it('answers another user\'s repository like a missing one', async () => {
      const { body } = await commit({ message: 'Update', paths: [ 'notes.md' ] }, 9).expect(404);

      expect(body).toMatchObject({ code: 'not-found' });
    });

    // Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
    it.skipIf(process.platform === 'win32')('publishes git.changed', async () => {
      await commit({ message: 'Update', paths: [ 'notes.md' ] }).expect(201);

      expect(published).toEqual([ { type: 'git.changed', repositoryId: READY } ]);
    });

    // Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
    describe.skipIf(process.platform === 'win32')('amending', () => {
      it('amends with no paths, changing only the message', async () => {
        const before = git(root, 'show', '--name-status', '--format=', 'HEAD').trim();

        const { body } = await commit({ message: 'Better', paths: [], amend: true }).expect(201);

        expect(body).toEqual({ oid: git(root, 'rev-parse', 'HEAD').trim() });
        expect(git(root, 'log', '--format=%s').trim()).toBe('Better');
        expect(git(root, 'show', '--name-status', '--format=', 'HEAD').trim()).toBe(before);
        expect(authorOf()).toBe('Ada Lovelace <ada@example.com> / Ada Lovelace <ada@example.com>');
        expect(published).toEqual([ { type: 'git.changed', repositoryId: READY } ]);
      });

      it('refuses an amend of a commit that was pushed meanwhile', async () => {
        const head = git(root, 'rev-parse', 'HEAD');
        git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');

        const { body } = await commit({ message: 'Better', paths: [], amend: true }).expect(409);

        expect(body).toMatchObject({ code: 'amend-not-allowed' });
        expect(git(root, 'rev-parse', 'HEAD')).toBe(head);
        expect(published).toEqual([]);
      });

      it('refuses an amend from a user who has not confirmed', async () => {
        commitAuthor = { ...commitAuthor, confirmed: false };

        const { body } = await commit({ message: 'Better', paths: [], amend: true }).expect(409);

        expect(body).toMatchObject({ code: 'commit-author-not-confirmed' });
        expect(git(root, 'log', '--format=%s').trim()).toBe('base');
      });

      it('checks the listed paths', async () => {
        const { body } = await commit({ message: 'Better', paths: [ '.git/config' ], amend: true }).expect(400);

        expect(body).toMatchObject({ code: 'path-refused', params: { reason: 'inside-git' } });
      });

      it('reports in the status that a pushed commit can no longer be amended', async () => {
        git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');

        const { body } = await status().expect(200);

        expect(body.lastCommit).toEqual({
          oid: git(root, 'rev-parse', 'HEAD').trim(),
          amendable: false,
          message: null
        });
      });
    });
  });
});
