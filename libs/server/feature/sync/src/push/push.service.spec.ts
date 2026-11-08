import { jobs } from '@front-burner/server-core-database';
import { EventsHub } from '@front-burner/server-core-events';
import { GitEngine } from '@front-burner/server-core-git';
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
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { FetchService } from '../fetch/fetch.service';
import { GitController } from '../git/git.controller';
import { GitJobs } from '../jobs/git-jobs.service';
import { SyncStateStore } from '../state/sync-state.store';
import { insertRepository } from '../testing/fixtures';
import { git, trustTestCertificate } from '../testing/git-fixtures';
import { PushHarness } from '../testing/push-harness';
import { PUSH_JOB_TYPE } from './push.job';
import { PushService } from './push.service';

const SESSION = 'session-1';

// The broker listens on a Unix socket in a POSIX path: not on Windows.
describe.skipIf(process.platform === 'win32')('PushService', () => {
  let restoreCa: () => void;
  let harness: PushHarness;
  let app: INestApplication;

  const http = () => request(app.getHttpServer());
  const push = (id = harness.repositoryId) => http().post(`/repositories/${id}/git/push`);
  const jobState = (jobId: number, id = harness.repositoryId) => http().get(`/repositories/${id}/git/jobs/${jobId}`);
  const pushJobs = () => harness.database.db.select().from(jobs).where(eq(jobs.type, PUSH_JOB_TYPE)).all();

  async function startApp(): Promise<void> {
    const moduleRef = await Test.createTestingModule({
      controllers: [ GitController ],
      providers: [
        { provide: GitEngine, useValue: harness.engine },
        { provide: WorkingTreeGuard, useValue: harness.guard },
        { provide: OpenableRepository, useValue: harness.openable },
        { provide: CommitAuthors, useValue: {} },
        { provide: EventsHub, useValue: harness.events },
        { provide: PushService, useValue: harness.service },
        { provide: FetchService, useValue: harness.fetchService },
        { provide: GitJobs, useValue: harness.gitJobs },
        { provide: SyncStateStore, useValue: harness.syncState },
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
    await startApp();
  });

  afterEach(async () => {
    await app.close();
    await harness.close();
  });

  it('answers 202 with the job, and one job for two requests', async () => {
    harness.commit('second');

    const first = await push().expect(202);
    const second = await push().expect(202);

    expect(first.body).toEqual({ jobId: expect.any(Number) });
    expect(second.body).toEqual(first.body);
    expect(pushJobs()).toEqual([
      expect.objectContaining({
        id: first.body.jobId,
        userId: harness.alice,
        repositoryId: harness.repositoryId,
        payload: JSON.stringify({ branch: 'main' }),
        dedupeKey: `push:${harness.repositoryId}:main`
      })
    ]);
  });

  it('reports the running push in the status', async () => {
    harness.commit('second');
    const { body } = await push().expect(202);

    const status = await http().get(`/repositories/${harness.repositoryId}/git/status`).expect(200);

    expect(status.body).toMatchObject({ networkJob: { id: body.jobId, type: 'push' } });
  });

  it('publishes git.changed when it queues a push, so that other tabs show it running', async () => {
    harness.commit('second');

    await push().expect(202);

    expect(harness.published).toContainEqual({
      userId: harness.alice,
      event: { type: 'git.changed', repositoryId: harness.repositoryId }
    });
  });

  it('refuses during a merge, on a detached HEAD, without commits and with nothing to push', async () => {
    harness.commit('second');
    const head = git(harness.workingCopy, 'rev-parse', 'HEAD').trim();
    writeFileSync(join(harness.workingCopy, '.git', 'MERGE_HEAD'), `${head}\n`);
    expect((await push().expect(409)).body).toMatchObject({ code: 'merge-in-progress' });
    git(harness.workingCopy, 'merge', '--abort');

    git(harness.workingCopy, 'checkout', '-q', '--detach');
    expect((await push().expect(409)).body).toMatchObject({ code: 'no-branch' });

    git(harness.workingCopy, 'checkout', '-q', '--orphan', 'fresh');
    expect((await push().expect(409)).body).toMatchObject({ code: 'no-commits' });

    git(harness.workingCopy, 'checkout', '-q', 'main');
    git(harness.workingCopy, 'reset', '-q', '--hard', 'origin/main');
    expect((await push().expect(409)).body).toMatchObject({ code: 'nothing-to-push' });

    expect(pushJobs()).toEqual([]);
  });

  it('pushes a branch whose upstream is gone, which creates it again', async () => {
    // As when the remote branch was deleted and the next fetch pruned it.
    git(harness.workingCopy, 'update-ref', '-d', 'refs/remotes/origin/main');
    git(harness.bare, 'update-ref', '-d', 'refs/heads/main');
    harness.runner.start();
    expect((await http().get(`/repositories/${harness.repositoryId}/git/status`).expect(200)).body)
      .toMatchObject({ upstream: 'origin/main', upstreamGone: true, ahead: 0 });

    const { jobId } = (await push().expect(202)).body as { jobId: number; };
    await harness.finished(jobId);

    expect((await jobState(jobId).expect(200)).body).toEqual({
      status: 'done',
      outcome: { kind: 'pushed', commits: 1, upstream: 'origin/main' }
    });
    expect(harness.remoteLog()).toBe('first');
  });

  it('queues one job per branch', async () => {
    harness.commit('second');
    const onMain = (await push().expect(202)).body as { jobId: number; };
    git(harness.workingCopy, 'checkout', '-q', '-b', 'draft');
    harness.commit('draft work');

    const onDraft = (await push().expect(202)).body as { jobId: number; };

    expect(onDraft.jobId).not.toBe(onMain.jobId);
    expect(pushJobs().map(job => JSON.parse(job.payload) as unknown)).toEqual([
      { branch: 'main' },
      { branch: 'draft' }
    ]);
    harness.runner.start();
    await harness.finished(onDraft.jobId);
    expect((await jobState(onDraft.jobId).expect(200)).body).toMatchObject({
      outcome: { kind: 'pushed', upstream: 'origin/draft' }
    });
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
    git(harness.layout.workingCopy(harness.alice, id), 'commit', '-q', '--allow-empty', '-m', 'second');

    const refused = await push(id).expect(409);

    expect(refused.body).toMatchObject({ code: 'key-locked', params: { keyId, keyName: 'Laptop' } });
    expect(pushJobs()).toEqual([]);

    harness.saved.unlock(harness.alice, SESSION, keyId, FIXTURE_PASSPHRASE);
    const started = await push(id).expect(202);
    expect(harness.jobKeys.take(started.body.jobId, keyId)).toBeDefined();
  });
});
