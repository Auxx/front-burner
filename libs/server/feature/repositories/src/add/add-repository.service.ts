import { DATABASE, Database, repositories, Tx, users } from '@front-burner/server-core-database';
import { JobRunner } from '@front-burner/server-core-jobs';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { JobKeys, KeyUnlockStore } from '@front-burner/server-feature-credentials';
import {
  type AccessCheckRequest,
  type AccessCheckResult,
  type AddRepositoryRequest,
  GIT_LEVELS,
  type GitLevel,
  type RepositorySummary
} from '@front-burner/shared-contracts';
import { type ParsedRemote, parseRemoteUrl } from '@front-burner/shared-util';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { toSummary } from '../repositories/repository-queries';
import { CredentialsCheck } from './credentials-check';
import { RequestCredentials } from './request-credentials';

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
    private readonly credentialsCheck: CredentialsCheck,
    private readonly unlocks: KeyUnlockStore,
    private readonly runner: JobRunner,
    private readonly jobKeys: JobKeys
  ) {}

  /** The branch list of the form (AR-35). */
  async accessCheck(user: RequestUser, request: AccessCheckRequest): Promise<AccessCheckResult> {
    const remote = remoteOf(request.remoteUrl);
    const credentials = this.requestCredentials.resolve(user, remote.protocol, request.credentials);
    return this.credentialsCheck.check(user, request.remoteUrl, remote, request.credentials.mode, credentials);
  }

  /** @throws ApiErrorException field errors and the codes of {@link toAddRepositoryError}. */
  async add(user: RequestUser, request: AddRepositoryRequest): Promise<RepositorySummary> {
    const gitLevel = this.levelFor(user.id, request.gitLevel);
    this.assertNameFree(this.database.db, user.id, request.name);
    this.credentialsCheck.assertNameFree(user.id, request.credentials);
    const remote = remoteOf(request.remoteUrl);
    const credentials = this.requestCredentials.resolve(user, remote.protocol, request.credentials);
    const result = await this.credentialsCheck.check(
      user,
      request.remoteUrl,
      remote,
      request.credentials.mode,
      credentials
    );
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
      const credentialId = this.credentialsCheck.saveNew(tx, user.id, request.credentials) ?? credentials.savedId
        ?? null;
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
    if (credentials.protectedKey && credentials.git.kind === 'ssh' && row.credentialId !== null) {
      this.jobKeys.hold(jobId, row.credentialId, credentials.git.key);
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
}
