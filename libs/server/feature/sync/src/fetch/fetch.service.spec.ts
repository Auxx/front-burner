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
import { GitController } from '../git/git.controller';
import { GitJobs } from '../jobs/git-jobs.service';
import { PushService } from '../push/push.service';
import { SyncStateStore } from '../state/sync-state.store';
import { insertRepository } from '../testing/fixtures';
import { git, trustTestCertificate } from '../testing/git-fixtures';
import { PushHarness } from '../testing/push-harness';
import { FetchScheduler } from './fetch-scheduler';
import { FETCH_JOB_TYPE } from './fetch.job';
import { FetchService } from './fetch.service';

const SESSION = 'session-1';

// The broker listens on a Unix socket in a POSIX path: not on Windows.
describe.skipIf(process.platform === 'win32')('FetchService', () => {
  let restoreCa: () => void;
  let harness: PushHarness;
  let app: INestApplication;

  const http = () => request(app.getHttpServer());
  const fetch = (id = harness.repositoryId) => http().post(`/repositories/${id}/git/fetch`);
  const status = (id = harness.repositoryId) => http().get(`/repositories/${id}/git/status`);
  const incoming = (path?: string, id = harness.repositoryId) =>
    http().get(`/repositories/${id}/git/incoming`).query(path === undefined ? {} : { path });
  const jobState = (jobId: number, id = harness.repositoryId) => http().get(`/repositories/${id}/git/jobs/${jobId}`);
  const fetchJobs = () => harness.database.db.select().from(jobs).where(eq(jobs.type, FETCH_JOB_TYPE)).all();

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
        { provide: FetchScheduler, useValue: {} },
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
    const first = await fetch().expect(202);
    const second = await fetch().expect(202);

    expect(first.body).toEqual({ jobId: expect.any(Number) });
    expect(second.body).toEqual(first.body);
    expect(fetchJobs()).toEqual([
      expect.objectContaining({
        id: first.body.jobId,
        userId: harness.alice,
        repositoryId: harness.repositoryId,
        dedupeKey: `fetch-now:${harness.repositoryId}`
      })
    ]);
    // So that the user's other tabs show the fetch running (GA-9).
    expect(harness.published).toContainEqual({
      userId: harness.alice,
      event: { type: 'git.changed', repositoryId: harness.repositoryId }
    });

    harness.runner.start();
    await harness.finished(first.body.jobId);
    expect((await jobState(first.body.jobId).expect(200)).body).toEqual({
      status: 'done',
      outcome: { kind: 'fetched', moved: false }
    });
  });

  it('queues a fetch during a merge', async () => {
    const head = git(harness.workingCopy, 'rev-parse', 'HEAD').trim();
    writeFileSync(join(harness.workingCopy, '.git', 'MERGE_HEAD'), `${head}\n`);

    await fetch().expect(202);

    expect(fetchJobs()).toHaveLength(1);
  });

  it('answers another user\'s repository like a missing one', async () => {
    const other = insertRepository(harness.database, harness.bob, { name: 'Theirs' });

    expect((await fetch(other).expect(404)).body).toMatchObject({ code: 'not-found' });
    expect(fetchJobs()).toEqual([]);
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

    const refused = await fetch(id).expect(409);

    expect(refused.body).toMatchObject({ code: 'key-locked', params: { keyId, keyName: 'Laptop' } });
    expect(fetchJobs()).toEqual([]);

    harness.saved.unlock(harness.alice, SESSION, keyId, FIXTURE_PASSPHRASE);
    const started = await fetch(id).expect(202);
    expect(harness.jobKeys.take(started.body.jobId, keyId)).toBeDefined();
  });

  it('reports the running fetch in the status, and the last fetch\'s problem', async () => {
    const { body } = await fetch().expect(202);

    expect((await status().expect(200)).body).toMatchObject({
      networkJob: { id: body.jobId, type: 'fetch' },
      fetchProblem: null
    });

    harness.useRemote('https://127.0.0.1:1/handbook.git');
    harness.runner.start();
    await harness.finished(body.jobId);
    expect((await status().expect(200)).body).toMatchObject({
      networkJob: null,
      fetchProblem: { code: 'host-unreachable', params: { host: '127.0.0.1' } }
    });
  });

  it('says what is incoming after a fetch', async () => {
    writeFileSync(join(harness.root, 'seed', 'notes.md'), 'theirs\n');
    git(join(harness.root, 'seed'), 'add', 'notes.md');
    harness.pushFromElsewhere('notes');
    harness.pushFromElsewhere('more');
    expect((await incoming('notes.md').expect(200)).body).toEqual({
      incoming: { upstream: 'origin/main', commits: 0, touchesPath: false }
    });

    const { body } = await fetch().expect(202);
    harness.runner.start();
    await harness.finished(body.jobId);

    expect((await incoming('notes.md').expect(200)).body).toEqual({
      incoming: { upstream: 'origin/main', commits: 2, touchesPath: true }
    });
    expect((await incoming('other.md').expect(200)).body).toEqual({
      incoming: { upstream: 'origin/main', commits: 2, touchesPath: false }
    });
    expect((await incoming().expect(200)).body).toEqual({
      incoming: { upstream: 'origin/main', commits: 2, touchesPath: false }
    });
    expect((await status().expect(200)).body).toMatchObject({ behind: 2 });

    git(harness.workingCopy, 'checkout', '-q', '--detach');
    expect((await incoming().expect(200)).body).toEqual({ incoming: null });
  });
});
