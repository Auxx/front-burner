import type { Config } from '@front-burner/server-core-config';
import { SecretBox } from '@front-burner/server-core-crypto';
import { Database, Job, jobs, repositories } from '@front-burner/server-core-database';
import type { EventsHub } from '@front-burner/server-core-events';
import { GitEngine, GitOptions, GitRunner, NetworkLock, WorkingTreeLock } from '@front-burner/server-core-git';
import { GitHttpServer, GitHttpServerOptions, startGitHttpServer } from '@front-burner/server-core-git/testing';
import { JobRunner } from '@front-burner/server-core-jobs';
import { SessionLifecycle } from '@front-burner/server-core-security';
import { DataLayout } from '@front-burner/server-core-storage';
import {
  JobKeys,
  KeyUnlockStore,
  KnownHostsService,
  SavedCredentialsService,
  UnlockAttempts
} from '@front-burner/server-feature-credentials';
import { OpenableRepository, WorkingTreeGuard } from '@front-burner/server-feature-files';
import { RepositoryQueries } from '@front-burner/server-feature-repositories';
import type { PushEvent } from '@front-burner/shared-contracts';
import { eq } from 'drizzle-orm';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { GitJobs } from '../jobs/git-jobs.service';
import { PushJob } from '../push/push.job';
import { PushService } from '../push/push.service';
import { insertRepository, insertUser } from './fixtures';
import { createRemote, git, testGitOptions } from './git-fixtures';
import { createTestDatabase } from './test-database';

const box = new SecretBox('push-spec-key-0123456789abcdef0123');

/** Polls until `check` holds, for at most 20 seconds. */
export async function waitFor(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error('timed out waiting');
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

/**
 * Everything a push needs, for real: a database, the job runner, the git engine,
 * an HTTPS remote and a working copy of it for one user. Call `close()` after
 * each test.
 */
export class PushHarness {
  readonly root = mkdtempSync(join(tmpdir(), 'fb-push-'));
  readonly bare = createRemote(this.root);
  readonly database: Database = createTestDatabase();
  readonly layout = new DataLayout(join(this.root, 'data'));
  readonly published: { userId: number; event: PushEvent; }[] = [];
  readonly events = {
    publish: (userId: number, event: PushEvent) => this.published.push({ userId, event }),
    publishToSession: () => undefined
  } as unknown as EventsHub;
  readonly lifecycle = new SessionLifecycle();
  readonly unlocks = new KeyUnlockStore({ keyUnlockIdleMs: 3_600_000 } as Config, this.lifecycle, this.events);
  readonly saved = new SavedCredentialsService(this.database, box, this.unlocks, new UnlockAttempts());
  readonly jobKeys = new JobKeys();
  readonly queries = new RepositoryQueries(this.database);
  readonly openable = new OpenableRepository(this.queries, this.layout);
  readonly networkLock = new NetworkLock();
  readonly alice = insertUser(this.database, 'alice@x.io');
  readonly bob = insertUser(this.database, 'bob@x.io');
  server!: GitHttpServer;
  runner!: JobRunner;
  engine!: GitEngine;
  guard!: WorkingTreeGuard;
  service!: PushService;
  gitJobs!: GitJobs;
  repositoryId = 0;

  static async start(serverOptions: Partial<GitHttpServerOptions> = {}): Promise<PushHarness> {
    const harness = new PushHarness();
    await harness.serve(serverOptions);
    mkdirSync(harness.layout.tmpDir, { recursive: true });
    harness.repositoryId = insertRepository(harness.database, harness.alice, {
      name: 'Handbook',
      remoteUrl: harness.remoteUrl
    });
    const workingCopy = harness.workingCopy;
    mkdirSync(dirname(workingCopy), { recursive: true });
    git(harness.root, 'clone', '-q', harness.bare, workingCopy);
    git(workingCopy, 'remote', 'set-url', 'origin', harness.remoteUrl);
    harness.build();
    return harness;
  }

  get remoteUrl(): string {
    return `${this.server.url}/handbook.git`;
  }

  get workingCopy(): string {
    return this.layout.workingCopy(this.alice, this.repositoryId);
  }

  /** Answers with another server; the stored remote and `origin` follow it. */
  async serve(options: Partial<GitHttpServerOptions>): Promise<void> {
    await this.server?.close();
    this.server = await startGitHttpServer({ repositories: { 'handbook.git': this.bare }, ...options });
    if (this.repositoryId !== 0) {
      this.database.db.update(repositories).set({ remoteUrl: this.remoteUrl })
        .where(eq(repositories.id, this.repositoryId)).run();
      git(this.workingCopy, 'remote', 'set-url', 'origin', this.remoteUrl);
    }
  }

  /** A new runner and engine over the same database, as after a restart. */
  build(gitOptions: GitOptions = testGitOptions()): void {
    this.runner = new JobRunner(this.database, { cloneConcurrency: 2 } as Config, this.events);
    this.engine = new GitEngine(gitOptions, new GitRunner());
    this.guard = new WorkingTreeGuard(new WorkingTreeLock(), this.engine);
    const knownHosts = new KnownHostsService(this.database, gitOptions);
    new PushJob(
      this.runner,
      this.engine,
      this.networkLock,
      this.openable,
      this.saved,
      knownHosts,
      this.jobKeys,
      this.events
    ).onModuleInit();
    this.gitJobs = new GitJobs(this.database);
    this.service = new PushService(
      this.runner,
      this.engine,
      this.openable,
      this.saved,
      this.jobKeys,
      this.events
    );
  }

  commit(subject: string): void {
    git(this.workingCopy, 'commit', '-q', '--allow-empty', '-m', subject);
  }

  remoteLog(ref = 'main'): string {
    return git(this.bare, 'log', '--format=%s', ref).trim();
  }

  jobOf(id: number): Job | undefined {
    return this.database.db.select().from(jobs).where(eq(jobs.id, id)).get();
  }

  /** Waits for the job to end. */
  finished(id: number): Promise<void> {
    return waitFor(() => this.jobOf(id)?.finishedAt != null);
  }

  async close(): Promise<void> {
    await this.runner.beforeApplicationShutdown();
    await this.engine.beforeApplicationShutdown();
    this.unlocks.onModuleDestroy();
    await this.server.close();
    this.database.sqlite.close();
    rmSync(this.root, { recursive: true, force: true });
  }
}
