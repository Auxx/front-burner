import { DATABASE, Database, repositories, Repository } from '@front-burner/server-core-database';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { KeyUnlockStore, SavedCredentialsService } from '@front-burner/server-feature-credentials';
import {
  modeFitsProtocol,
  type RepositoryCredentials,
  type RepositoryCredentialsInfo,
  type UpdateTokenRequest
} from '@front-burner/shared-contracts';
import { type ParsedRemote, parseRemoteUrl } from '@front-burner/shared-util';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, count, eq } from 'drizzle-orm';
import type { RequestUser } from '../add/add-repository.service';
import { CredentialsCheck } from '../add/credentials-check';
import { RequestCredentials } from '../add/request-credentials';
import { RepositoryQueries } from '../repositories/repository-queries';

const notFound = () => new ApiErrorException(404, 'not-found');

/** The repository's remote, checked when it was added (AR-9). */
function remoteOf(repository: Repository): ParsedRemote {
  const result = parseRemoteUrl(repository.remoteUrl);
  if (!result.ok) {
    throw new Error(`Repository ${repository.id} has an invalid remote URL`);
  }
  return result.remote;
}

/**
 * Which credentials a repository uses, with their public parts only (RC-7,
 * RC-12, RC-15, A-3.5), and replacing or updating them after an access check
 * (RC-8, RC-13). Reading never keeps a key unlocked (AR-31).
 */
@Injectable()
export class RepositoryCredentialsService {
  private readonly logger = new Logger(RepositoryCredentialsService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly queries: RepositoryQueries,
    private readonly saved: SavedCredentialsService,
    private readonly requestCredentials: RequestCredentials,
    private readonly credentialsCheck: CredentialsCheck,
    private readonly unlocks: KeyUnlockStore
  ) {}

  /**
   * @throws ApiErrorException 404 `not-found` for a missing repository or
   * another user's (RC-1, FB-2).
   */
  get(userId: number, sessionId: string, repositoryId: number): RepositoryCredentialsInfo {
    const repository = this.queries.find(userId, repositoryId);
    if (repository === undefined) {
      throw notFound();
    }
    const protocol = remoteOf(repository).protocol;
    if (repository.credentialId === null) {
      return { protocol, inUse: null };
    }
    // Always the user's: a repository is added only with the user's own credentials (AR-56).
    const row = this.saved.findOwned(userId, repository.credentialId);
    return { protocol, inUse: { ...this.saved.toPublic(row, sessionId), usedBy: this.usedBy(userId, row.id) } };
  }

  /**
   * Makes the repository use other credentials once an access check with them
   * passes (RC-8), as the Add repository page does: new credentials are saved
   * to the user's profile, and the old ones are kept (RC-10). A failed check
   * changes nothing. A push that is already running keeps what it read when
   * it started (RC-19).
   *
   * @throws ApiErrorException 404 `not-found`, 409 `repository-not-openable`,
   * `kind-mismatch` on `credentials`, and the errors of the Add repository
   * page (AR-42).
   */
  async replace(
    user: RequestUser,
    repositoryId: number,
    credentials: RepositoryCredentials
  ): Promise<RepositoryCredentialsInfo> {
    const repository = this.ready(user.id, repositoryId);
    const remote = remoteOf(repository);
    if (!modeFitsProtocol(credentials.mode, remote.protocol)) {
      // The protocol can't be changed here (RC-7).
      throw ApiErrorException.forFields([ { path: 'credentials', code: 'kind-mismatch', params: {} } ]);
    }
    this.credentialsCheck.assertNameFree(user.id, credentials);
    const resolved = this.requestCredentials.resolve(user, remote.protocol, credentials);
    await this.credentialsCheck.check(user, repository.remoteUrl, remote, credentials.mode, resolved);

    const credentialId = this.database.db.transaction(tx => {
      const id = this.credentialsCheck.saveNew(tx, user.id, credentials) ?? resolved.savedId ?? null;
      const changed = tx.update(repositories).set({ credentialId: id })
        .where(and(eq(repositories.id, repositoryId), eq(repositories.userId, user.id)))
        .run().changes;
      if (changed === 0) {
        // Removed while the access check ran.
        throw notFound();
      }
      return id;
    });
    if (credentials.mode === 'new-ssh-key' && credentials.passphrase !== undefined && credentialId !== null) {
      // AR-31: a pasted key's passphrase unlocks it for the session once checked.
      this.unlocks.unlock(user.sessionId, credentialId, credentials.privateKey, credentials.passphrase);
    }
    this.logger.log(`User ${user.id} replaced the credentials of repository ${repositoryId}`);
    return this.get(user.id, user.sessionId, repositoryId);
  }

  /**
   * Replaces the username and token of the saved HTTPS credentials the
   * repository uses, once an access check against this repository passes
   * with them (RC-13). Every repository that uses them uses the new token from
   * then on; other repositories are not checked. A failed check changes
   * nothing.
   *
   * @throws ApiErrorException 404 `not-found`, 409 `repository-not-openable`,
   * 409 `credentials-not-updatable` for a repository without saved HTTPS
   * credentials (RC-14), and the errors of the Add repository page (AR-42).
   */
  async updateToken(
    user: RequestUser,
    repositoryId: number,
    input: UpdateTokenRequest
  ): Promise<RepositoryCredentialsInfo> {
    const repository = this.ready(user.id, repositoryId);
    const credentialId = repository.credentialId;
    if (credentialId === null || this.saved.findOwned(user.id, credentialId).kind !== 'https') {
      throw new ApiErrorException(409, 'credentials-not-updatable', {});
    }
    await this.credentialsCheck.check(user, repository.remoteUrl, remoteOf(repository), 'new-https', {
      git: { kind: 'https', username: input.username, password: input.password },
      savedId: credentialId,
      generated: false,
      protectedKey: false
    });

    this.database.db.transaction(tx => this.saved.replaceHttps(tx, user.id, credentialId, input));
    this.logger.log(`User ${user.id} updated saved credentials ${credentialId} from repository ${repositoryId}`);
    return this.get(user.id, user.sessionId, repositoryId);
  }

  /** One of the user's repositories, if it is `ready` (FB-3): a clone is still using its credentials. */
  private ready(userId: number, repositoryId: number): Repository {
    const repository = this.queries.find(userId, repositoryId);
    if (repository === undefined) {
      throw notFound();
    }
    if (repository.status !== 'ready') {
      throw new ApiErrorException(409, 'repository-not-openable', { status: repository.status });
    }
    return repository;
  }

  /** How many of the user's repositories use these credentials (RC-12). */
  private usedBy(userId: number, credentialId: number): number {
    return this.database.db.select({ value: count() }).from(repositories)
      .where(and(eq(repositories.userId, userId), eq(repositories.credentialId, credentialId)))
      .get()?.value ?? 0;
  }
}
