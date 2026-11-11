import type { Config } from '@front-burner/server-core-config';
import { SecretBox } from '@front-burner/server-core-crypto';
import { Database, Job, jobs, repositories } from '@front-burner/server-core-database';
import type { EventsHub } from '@front-burner/server-core-events';
import {
  GitEngine,
  GitMerge,
  GitOptions,
  GitRunner,
  LocalGit,
  NetworkLock,
  WorkingTreeLock
} from '@front-burner/server-core-git';
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
import { CommitAuthors } from '@front-burner/server-feature-preferences';
import { InstanceRepositories, RepositoryQueries } from '@front-burner/server-feature-repositories';
import type { PushEvent } from '@front-burner/shared-contracts';
import { eq } from 'drizzle-orm';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { FetchStep } from '../fetch/fetch-step';
import { FetchJob } from '../fetch/fetch.job';
import { FetchService } from '../fetch/fetch.service';
import { GitJobs } from '../jobs/git-jobs.service';
import { JobCredentials } from '../jobs/job-credentials.service';
import { NetworkJobs } from '../jobs/network-jobs.service';
import { PullJob } from '../pull/pull.job';
import { PullService } from '../pull/pull.service';
import { PushJob } from '../push/push.job';
import { PushService } from '../push/push.service';
import { MergeRecord } from '../state/merge-record';
import { SyncStateStore } from '../state/sync-state.store';
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
 * Everything a push or a fetch needs, for real: a database, the job runner, the
 * git engine, an HTTPS remote and a working copy of it for one user. Call
 * `close()` after each test.
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
  readonly jobCredentials = new JobCredentials(this.saved, this.jobKeys);
  readonly queries = new RepositoryQueries(this.database);
  readonly openable = new OpenableRepository(this.queries, this.layout);
  readonly networkLock = new NetworkLock();
  readonly syncState = new SyncStateStore(this.database);
  readonly commitAuthors = new CommitAuthors(this.database, this.queries);
  readonly alice = insertUser(this.database, 'alice@x.io');
  readonly bob = insertUser(this.database, 'bob@x.io');
  server!: GitHttpServer;
  runner!: JobRunner;
  engine!: GitEngine;
  merge!: GitMerge;
  guard!: WorkingTreeGuard;
  /** The lock that `guard` and the jobs take. */
  workingTreeLock!: WorkingTreeLock;
  mergeRecord!: MergeRecord;
  service!: PushService;
  pullService!: PullService;
  fetchStep!: FetchStep;
  fetchService!: FetchService;
  gitJobs!: GitJobs;
  networkJobs!: NetworkJobs;
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
      this.useRemote(this.remoteUrl);
    }
  }

  /** Points the stored remote and `origin` at `url`. */
  useRemote(url: string): void {
    this.database.db.update(repositories).set({ remoteUrl: url }).where(eq(repositories.id, this.repositoryId)).run();
    git(this.workingCopy, 'remote', 'set-url', 'origin', url);
  }

  /** Commits what is staged in the seed clone, and pushes it to the remote, as another user does. */
  pushFromElsewhere(subject: string): void {
    const seed = join(this.root, 'seed');
    git(seed, 'commit', '-q', '--allow-empty', '-m', subject);
    git(seed, 'push', '-q', this.bare, 'main');
  }

  /** A new runner and engine over the same database, as after a restart. */
  build(gitOptions: GitOptions = testGitOptions()): void {
    this.runner = new JobRunner(this.database, { cloneConcurrency: 2 } as Config, this.events);
    this.engine = new GitEngine(gitOptions, new GitRunner());
    this.merge = new GitMerge(new LocalGit(new GitRunner()), gitOptions);
    this.workingTreeLock = new WorkingTreeLock();
    this.mergeRecord = new MergeRecord(this.syncState, this.merge);
    this.guard = new WorkingTreeGuard(this.workingTreeLock, this.engine, this.merge);
    const knownHosts = new KnownHostsService(this.database, gitOptions);
    this.fetchStep = new FetchStep(
      this.engine,
      this.networkLock,
      this.openable,
      this.jobCredentials,
      knownHosts,
      this.syncState,
      this.events
    );
    new PushJob(
      this.runner,
      this.engine,
      this.networkLock,
      this.openable,
      this.jobCredentials,
      knownHosts,
      this.fetchStep,
      this.jobKeys,
      this.events,
      this.workingTreeLock,
      this.mergeRecord
    ).onModuleInit();
    new FetchJob(this.runner, this.fetchStep, this.jobKeys).onModuleInit();
    new PullJob(
      this.runner,
      this.fetchStep,
      this.openable,
      this.engine,
      this.merge,
      this.guard,
      this.commitAuthors,
      this.syncState,
      this.mergeRecord,
      new InstanceRepositories(this.database),
      this.jobKeys,
      this.events
    ).onModuleInit();
    this.networkJobs = new NetworkJobs(this.runner, this.saved, this.jobKeys, this.events);
    this.fetchService = new FetchService(this.openable, this.networkJobs);
    this.gitJobs = new GitJobs(this.database);
    this.service = new PushService(this.engine, this.openable, this.networkJobs);
    this.pullService = new PullService(this.engine, this.merge, this.openable, this.networkJobs);
  }

  /** Confirms the user's commit author, as the Preferences page does (CA-13). */
  confirmAuthor(userId = this.alice): void {
    this.commitAuthors.setDefault(userId, { name: 'Alice Example', email: 'alice@example.com' });
  }

  /** Commits `content` to `path` in the seed clone and pushes it to the remote, as another user does. */
  pushFileFromElsewhere(path: string, content: string, subject = `change ${path}`, branch = 'main'): void {
    const seed = join(this.root, 'seed');
    git(seed, 'checkout', '-q', '-B', branch);
    mkdirSync(dirname(join(seed, path)), { recursive: true });
    writeFileSync(join(seed, path), content);
    git(seed, 'add', '--', path);
    git(seed, 'commit', '-q', '-m', subject);
    git(seed, 'push', '-q', '-f', this.bare, branch);
    git(seed, 'checkout', '-q', 'main');
  }

  /** Commits `content` to `path` in the user's working copy. */
  commitFile(path: string, content: string, subject = `change ${path}`): void {
    mkdirSync(dirname(join(this.workingCopy, path)), { recursive: true });
    writeFileSync(join(this.workingCopy, path), content);
    git(this.workingCopy, 'add', '--', path);
    git(this.workingCopy, 'commit', '-q', '-m', subject);
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
