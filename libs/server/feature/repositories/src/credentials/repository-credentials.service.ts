import { DATABASE, Database, repositories } from '@front-burner/server-core-database';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { SavedCredentialsService } from '@front-burner/server-feature-credentials';
import type { RepositoryCredentialsInfo } from '@front-burner/shared-contracts';
import { parseRemoteUrl } from '@front-burner/shared-util';
import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq } from 'drizzle-orm';
import { RepositoryQueries } from '../repositories/repository-queries';

/**
 * Which credentials a repository uses, with their public parts only (RC-7,
 * RC-12, RC-15, A-3.5). Reading never keeps a key unlocked (AR-31).
 */
@Injectable()
export class RepositoryCredentialsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly queries: RepositoryQueries,
    private readonly saved: SavedCredentialsService
  ) {}

  /**
   * @throws ApiErrorException 404 `not-found` for a missing repository or
   * another user's (RC-1, FB-2).
   */
  get(userId: number, sessionId: string, repositoryId: number): RepositoryCredentialsInfo {
    const repository = this.queries.find(userId, repositoryId);
    if (repository === undefined) {
      throw new ApiErrorException(404, 'not-found');
    }
    const remote = parseRemoteUrl(repository.remoteUrl);
    if (!remote.ok) {
      // Checked when the repository was added (AR-9).
      throw new Error(`Repository ${repository.id} has an invalid remote URL`);
    }
    const protocol = remote.remote.protocol;
    if (repository.credentialId === null) {
      return { protocol, inUse: null };
    }
    // Always the user's: a repository is added only with the user's own credentials (AR-56).
    const row = this.saved.findOwned(userId, repository.credentialId);
    return { protocol, inUse: { ...this.saved.toPublic(row, sessionId), usedBy: this.usedBy(userId, row.id) } };
  }

  /** How many of the user's repositories use these credentials (RC-12). */
  private usedBy(userId: number, credentialId: number): number {
    return this.database.db.select({ value: count() }).from(repositories)
      .where(and(eq(repositories.userId, userId), eq(repositories.credentialId, credentialId)))
      .get()?.value ?? 0;
  }
}
