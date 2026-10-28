import { DATABASE, Database, repositories, savedCredentials, Tx, users } from '@front-burner/server-core-database';
import { GitEngine, GitOperationError } from '@front-burner/server-core-git';
import { JobRunner } from '@front-burner/server-core-jobs';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { KeyUnlockStore, KnownHostsService, SavedCredentialsService } from '@front-burner/server-feature-credentials';
import {
  type AccessCheckRequest,
  type AccessCheckResult,
  type AddRepositoryRequest,
  GIT_LEVELS,
  type GitLevel,
  type RepositoryCredentials,
  type RepositorySummary
} from '@front-burner/shared-contracts';
import { type ParsedRemote, parseRemoteUrl } from '@front-burner/shared-util';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { CloneKeys } from '../clone/clone-keys';
import { toSummary } from '../repositories/repository-queries';
import { toAddRepositoryError } from './remote-errors';
import { RequestCredentials, ResolvedCredentials } from './request-credentials';

/** The job type of the background clone (AR-49). */
export const CLONE_JOB_TYPE = 'repositories.clone';

export interface CloneJobPayload {
  repositoryId: number;
}

export interface RequestUser {
  id: number;
  sessionId: string;
}

const fieldError = (path: string, code: string, params: Record<string, unknown> = {}) =>
  ApiErrorException.forFields([ { path, code, params } ]);

const isUniqueViolation = (error: unknown): boolean =>
  (error as { code?: unknown; }).code === 'SQLITE_CONSTRAINT_UNIQUE';

/** The schema has checked the URL; this only takes it apart again. */
function remoteOf(url: string): ParsedRemote {
  const result = parseRemoteUrl(url);
  if (!('remote' in result)) {
    throw fieldError('remoteUrl', result.problem);
  }
  return result.remote;
}

/** Reports a credential's field error under `credentials.` (its name, AR-18). */
function underCredentials<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof ApiErrorException && error.fields !== undefined) {
      throw ApiErrorException.forFields(error.fields.map(field => ({ ...field, path: `credentials.${field.path}` })));
    }
    throw error;
  }
}

/**
 * Adds a repository (REQ-REPO-001): checks every field, runs the access check
 * and then, all or nothing, saves new credentials, creates the repository and
 * queues its clone (AR-41, AR-44).
 */
@Injectable()
export class AddRepositoryService {
  private readonly logger = new Logger(AddRepositoryService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly requestCredentials: RequestCredentials,
    private readonly saved: SavedCredentialsService,
    private readonly unlocks: KeyUnlockStore,
    private readonly knownHosts: KnownHostsService,
    private readonly engine: GitEngine,
    private readonly runner: JobRunner,
    private readonly cloneKeys: CloneKeys
  ) {}

  /** The branch list of the form (AR-35). */
  async accessCheck(user: RequestUser, request: AccessCheckRequest): Promise<AccessCheckResult> {
    const remote = remoteOf(request.remoteUrl);
    const credentials = this.requestCredentials.resolve(user, remote.protocol, request.credentials);
    return this.check(user, request.remoteUrl, remote, request.credentials.mode, credentials);
  }

  /** @throws ApiErrorException field errors and the codes of {@link toAddRepositoryError}. */
  async add(user: RequestUser, request: AddRepositoryRequest): Promise<RepositorySummary> {
    const gitLevel = this.levelFor(user.id, request.gitLevel);
    this.assertNameFree(this.database.db, user.id, request.name);
    this.assertCredentialNameFree(user.id, request.credentials);
    const remote = remoteOf(request.remoteUrl);
    const credentials = this.requestCredentials.resolve(user, remote.protocol, request.credentials);
    const result = await this.check(user, request.remoteUrl, remote, request.credentials.mode, credentials);
    const branch = request.cloneMode === 'single-branch' ? request.branch ?? '' : null;
    if (branch !== null && result.branches.length === 0) {
      throw fieldError('branch', 'no-branches');
    }
    if (branch !== null && !result.branches.includes(branch)) {
      throw fieldError('branch', 'branch-not-found');
    }

    const now = new Date();
    const { row, jobId } = this.database.db.transaction(tx => {
      // Checked again inside the transaction: another submit may have taken the name meanwhile (AC-REPO-001.2).
      this.assertNameFree(tx, user.id, request.name);
      const credentialId = this.saveNewCredentials(tx, user.id, request.credentials) ?? credentials.savedId ?? null;
      let inserted;
      try {
        inserted = tx.insert(repositories).values({
          userId: user.id,
          name: request.name,
          remoteUrl: request.remoteUrl,
          credentialId,
          cloneMode: request.cloneMode,
          branch,
          gitLevel,
          status: 'cloning',
          createdAt: now,
          lastAccessedAt: now
        }).returning().get();
      } catch (error) {
        throw isUniqueViolation(error) ? fieldError('name', 'name-taken', { name: request.name }) : error;
      }
      const payload: CloneJobPayload = { repositoryId: inserted.id };
      const id = this.runner.enqueue({
        type: CLONE_JOB_TYPE,
        userId: user.id,
        repositoryId: inserted.id,
        payload,
        dedupeKey: `clone:${inserted.id}`
      }, tx);
      return { row: inserted, jobId: id };
    });
    // Synchronously after the commit, before the runner's loop can start the job (AR-49).
    if (credentials.protectedKey && credentials.git.kind === 'ssh') {
      this.cloneKeys.hold(jobId, credentials.git.key);
    }
    if (
      request.credentials.mode === 'new-ssh-key' && request.credentials.passphrase !== undefined && row.credentialId
    ) {
      // AR-31: a pasted key's passphrase unlocks it for the session once checked.
      this.unlocks.unlock(
        user.sessionId,
        row.credentialId,
        request.credentials.privateKey,
        request.credentials.passphrase
      );
    }
    this.logger.debug(`User ${user.id} added repository ${row.id} (${row.name}); cloning`);
    return toSummary(row);
  }

  private async check(
    user: RequestUser,
    remoteUrl: string,
    remote: ParsedRemote,
    mode: RepositoryCredentials['mode'],
    credentials: ResolvedCredentials
  ): Promise<AccessCheckResult> {
    try {
      const result = await this.engine.accessCheck(remoteUrl, credentials.git, this.knownHosts.linesFor(user.id));
      return { branches: result.branches, defaultBranch: result.defaultBranch ?? null };
    } catch (error) {
      if (!(error instanceof GitOperationError)) {
        throw error;
      }
      // git's error, with credentials removed by the engine (AR-42, NF-10.5).
      this.logger.warn(`Access check of ${remote.host} failed with ${error.code}: ${error.detail.trim()}`);
      throw toAddRepositoryError(error, {
        host: remote.host,
        credentialsMode: mode,
        generatedKey: credentials.generated
      });
    }
  }

  /** The requested level, or the highest the user is allowed (AR-38 to AR-40). */
  private levelFor(userId: number, requested: GitLevel | undefined): GitLevel {
    const allowed = this.database.db.select({ levels: users.allowedGitLevels }).from(users)
      .where(eq(users.id, userId)).get()?.levels ?? [];
    if (requested === undefined) {
      const highest = GIT_LEVELS.filter(level => allowed.includes(level)).pop();
      if (highest === undefined) {
        throw fieldError('gitLevel', 'level-not-allowed');
      }
      return highest;
    }
    if (!allowed.includes(requested)) {
      throw fieldError('gitLevel', 'level-not-allowed');
    }
    return requested;
  }

  private assertNameFree(db: Tx | Database['db'], userId: number, name: string): void {
    const taken = db.select({ id: repositories.id }).from(repositories)
      .where(and(eq(repositories.userId, userId), eq(sql`lower(${repositories.name})`, name.toLowerCase())))
      .get();
    if (taken !== undefined) {
      throw fieldError('name', 'name-taken', { name });
    }
  }

  /** New credentials' names are checked with every other field, before the remote is contacted (AR-41). */
  private assertCredentialNameFree(userId: number, credentials: RepositoryCredentials): void {
    if (credentials.mode !== 'new-https' && credentials.mode !== 'new-ssh-key') {
      return;
    }
    const kind = credentials.mode === 'new-https' ? 'https' : 'ssh-key';
    const taken = this.database.db.select({ id: savedCredentials.id }).from(savedCredentials)
      .where(and(
        eq(savedCredentials.userId, userId),
        eq(savedCredentials.kind, kind),
        eq(sql`lower(${savedCredentials.name})`, credentials.name.toLowerCase())
      ))
      .get();
    if (taken !== undefined) {
      throw fieldError('credentials.name', 'name-taken');
    }
  }

  /** Saves new credentials in the transaction (AR-21, AR-28); undefined for none or saved ones. */
  private saveNewCredentials(tx: Tx, userId: number, credentials: RepositoryCredentials): number | undefined {
    switch (credentials.mode) {
      case 'new-https':
        return underCredentials(() => this.saved.createHttps(tx, userId, credentials));
      case 'new-ssh-key':
        return underCredentials(() => this.saved.createPastedKey(tx, userId, credentials));
      default:
        return undefined;
    }
  }
}
