import { jobs } from '@front-burner/server-core-database';
import { EventsHub } from '@front-burner/server-core-events';
import { GitEngine, GitMerge } from '@front-burner/server-core-git';
import { FIXTURE_PASSPHRASE, sshKeyFixture } from '@front-burner/server-core-git/testing';
import { ApiExceptionFilter } from '@front-burner/server-core-observability';
import { OpenableRepository, WorkingTreeGuard } from '@front-burner/server-feature-files';
import { CommitAuthors } from '@front-burner/server-feature-preferences';
import { INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import type { NextFunction, Request, Response } from 'express';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { FetchScheduler } from '../fetch/fetch-scheduler';
import { FetchService } from '../fetch/fetch.service';
import { GitController } from '../git/git.controller';
import { GitJobs } from '../jobs/git-jobs.service';
import { MergeStateService } from '../merge/merge-state.service';
import { PushService } from '../push/push.service';
import { SyncStateStore } from '../state/sync-state.store';
import { insertRepository } from '../testing/fixtures';
import { git, trustTestCertificate } from '../testing/git-fixtures';
import { PushHarness } from '../testing/push-harness';
import { PULL_JOB_TYPE } from './pull.job';
import { PullService } from './pull.service';

const SESSION = 'session-1';

// The broker listens on a Unix socket in a POSIX path: not on Windows.
describe.skipIf(process.platform === 'win32')('PullService', () => {
  let restoreCa: () => void;
  let harness: PushHarness;
  let app: INestApplication;

  const http = () => request(app.getHttpServer());
  const pull = (id = harness.repositoryId) => http().post(`/repositories/${id}/git/pull`);
  const status = () => http().get(`/repositories/${harness.repositoryId}/git/status`).expect(200);
  const jobState = (jobId: number) => http().get(`/repositories/${harness.repositoryId}/git/jobs/${jobId}`);
  const pullJobs = () => harness.database.db.select().from(jobs).where(eq(jobs.type, PULL_JOB_TYPE)).all();
  const subjects = (rev = 'HEAD') => git(harness.workingCopy, 'log', '--format=%s', rev).trim();

  /** Pulls through the API and waits for the job; gives its state. */
  async function pulled(): Promise<unknown> {
    const { jobId } = (await pull().expect(202)).body as { jobId: number; };
    await harness.finished(jobId);
    return (await jobState(jobId).expect(200)).body;
  }

  async function startApp(): Promise<void> {
    const moduleRef = await Test.createTestingModule({
      controllers: [ GitController ],
      providers: [
        { provide: GitEngine, useValue: harness.engine },
        { provide: GitMerge, useValue: harness.merge },
        { provide: WorkingTreeGuard, useValue: harness.guard },
        { provide: OpenableRepository, useValue: harness.openable },
        { provide: CommitAuthors, useValue: harness.commitAuthors },
        { provide: EventsHub, useValue: harness.events },
        { provide: PushService, useValue: harness.service },
        { provide: PullService, useValue: harness.pullService },
        { provide: FetchService, useValue: harness.fetchService },
        { provide: FetchScheduler, useValue: {} },
        { provide: GitJobs, useValue: harness.gitJobs },
        { provide: SyncStateStore, useValue: harness.syncState },
        { provide: MergeStateService, useValue: {} },
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor }
      ]
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    // Stands in for the auth middleware.
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.auth = { userId: harness.alice, sessionId: SESSION } as Request['auth'];
      next();
    });
    await app.init();
  }

  beforeAll(() => {
    restoreCa = trustTestCertificate();
  });

  afterAll(() => {
    restoreCa();
  });

  beforeEach(async () => {
    harness = await PushHarness.start();
    harness.confirmAuthor();
    await startApp();
  });

  afterEach(async () => {
    await app.close();
    await harness.close();
  });

  it('answers 202 with the job, and one job for two requests', async () => {
    const first = await pull().expect(202);
    const second = await pull().expect(202);

    expect(first.body).toEqual({ jobId: expect.any(Number) });
    expect(second.body).toEqual(first.body);
    expect(pullJobs()).toEqual([
      expect.objectContaining({
        id: first.body.jobId,
        userId: harness.alice,
        repositoryId: harness.repositoryId,
        payload: JSON.stringify({ branch: 'main' }),
        dedupeKey: `pull:${harness.repositoryId}:main`
      })
    ]);
    expect((await status()).body).toMatchObject({ networkJob: { id: first.body.jobId, type: 'pull' } });
  });

  it('refuses during a merge, on a detached HEAD, without an upstream and with uncommitted changes', async () => {
    const workingCopy = harness.workingCopy;
    const head = git(workingCopy, 'rev-parse', 'HEAD').trim();
    writeFileSync(join(workingCopy, '.git', 'MERGE_HEAD'), `${head}\n`);
    expect((await pull().expect(409)).body).toMatchObject({ code: 'merge-in-progress' });
    git(workingCopy, 'merge', '--abort');

    git(workingCopy, 'checkout', '-q', '--detach');
    expect((await pull().expect(409)).body).toMatchObject({ code: 'no-branch' });

    git(workingCopy, 'checkout', '-q', '--orphan', 'fresh');
    expect((await pull().expect(409)).body).toMatchObject({ code: 'no-upstream' });

    // An upstream that is gone, as after the remote branch was deleted and the fetch pruned it.
    git(workingCopy, 'checkout', '-q', '-f', 'main');
    git(workingCopy, 'update-ref', '-d', 'refs/remotes/origin/main');
    expect((await pull().expect(409)).body).toMatchObject({ code: 'no-upstream' });
    git(workingCopy, 'update-ref', 'refs/remotes/origin/main', head);

    writeFileSync(join(workingCopy, 'notes.md'), 'unsaved work\n');
    expect((await pull().expect(409)).body).toMatchObject({ code: 'uncommitted-changes' });

    expect(pullJobs()).toEqual([]);
  });

  it('pulls from origin only, also when a local branch is named like the upstream', async () => {
    const workingCopy = harness.workingCopy;
    git(workingCopy, 'branch', 'origin/main');
    expect((await status()).body).toMatchObject({ upstream: 'origin/main', upstreamGone: false });
    expect((await pull().expect(202)).body).toEqual({ jobId: expect.any(Number) });

    git(workingCopy, 'remote', 'add', 'other', harness.bare);
    git(workingCopy, 'fetch', '-q', harness.bare, '+refs/heads/*:refs/remotes/other/*');
    git(workingCopy, 'checkout', '-q', '-b', 'tracking-other', '--track', 'other/main');
    expect((await status()).body).toMatchObject({ upstream: 'other/main', upstreamGone: false });
    expect((await pull().expect(409)).body).toMatchObject({ code: 'no-upstream' });
  });

  it('refuses an unpublished branch without one', async () => {
    git(harness.workingCopy, 'checkout', '-q', '-b', 'topic');

    expect((await status()).body).toMatchObject({ branch: 'topic', upstream: null, sameNameRemote: false });
    expect((await pull().expect(409)).body).toMatchObject({ code: 'no-upstream' });
    expect(pullJobs()).toEqual([]);
  });

  it('pulls an unpublished branch with a remote branch of its name, and makes that its upstream', async () => {
    harness.pushFileFromElsewhere('topic.md', 'theirs\n', 'their topic', 'topic');
    git(harness.workingCopy, 'fetch', '-q', harness.bare, '+refs/heads/*:refs/remotes/origin/*');
    git(harness.workingCopy, 'checkout', '-q', '--no-track', '-b', 'topic', 'main');
    harness.commitFile('mine.md', 'mine\n', 'my topic');
    expect((await status()).body).toMatchObject({ branch: 'topic', upstream: null, sameNameRemote: true });
    harness.runner.start();

    expect(await pulled()).toEqual({
      status: 'done',
      outcome: { kind: 'pulled', result: 'merged', commits: 1, upstream: 'origin/topic' }
    });

    expect(git(harness.workingCopy, 'rev-parse', '--abbrev-ref', 'topic@{upstream}').trim()).toBe('origin/topic');
    expect(subjects('HEAD^2')).toBe('their topic\nfirst');
    expect((await status()).body).toMatchObject({
      upstream: 'origin/topic',
      ahead: 2,
      behind: 0,
      sameNameRemote: false
    });
  });

  it('pulls with only ignored files around', async () => {
    harness.pushFileFromElsewhere('.gitignore', 'build/\n', 'ignore the build');
    git(harness.workingCopy, 'pull', '-q', '--ff-only', harness.bare, 'main');
    git(harness.workingCopy, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    mkdirSync(join(harness.workingCopy, 'build'));
    writeFileSync(join(harness.workingCopy, 'build', 'site.html'), '<p>built</p>\n');
    harness.pushFileFromElsewhere('notes.md', 'theirs\n');
    harness.runner.start();

    expect(await pulled()).toEqual({
      status: 'done',
      outcome: { kind: 'pulled', result: 'fast-forward', commits: 1, upstream: 'origin/main' }
    });

    expect(readFileSync(join(harness.workingCopy, 'notes.md'), 'utf8')).toBe('theirs\n');
    expect(readFileSync(join(harness.workingCopy, 'build', 'site.html'), 'utf8')).toBe('<p>built</p>\n');
  });

  it('asks for a locked key before queueing', async () => {
    const keyId = harness.database.db.transaction(tx =>
      harness.saved.createPastedKey(tx, harness.alice, {
        name: 'Laptop',
        privateKey: sshKeyFixture('ed25519-passphrase'),
        passphrase: FIXTURE_PASSPHRASE
      })
    );
    const id = insertRepository(harness.database, harness.alice, { name: 'Keyed', credentialId: keyId });
    git(harness.root, 'clone', '-q', harness.bare, harness.layout.workingCopy(harness.alice, id));

    const refused = await pull(id).expect(409);

    expect(refused.body).toMatchObject({ code: 'key-locked', params: { keyId, keyName: 'Laptop' } });
    expect(pullJobs()).toEqual([]);

    harness.saved.unlock(harness.alice, SESSION, keyId, FIXTURE_PASSPHRASE);
    const started = await pull(id).expect(202);
    expect(harness.jobKeys.take(started.body.jobId, keyId)).toBeDefined();
  });
});
