import { GitEngine } from '@front-burner/server-core-git';
import { errorForLog } from '@front-burner/server-core-observability';
import { DATA_LAYOUT, DataLayout } from '@front-burner/server-core-storage';
import type { RemovalCheckResult } from '@front-burner/shared-contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ownRow, RepositoryQueries } from '../repositories/repository-queries';

/** Nothing would be lost. */
const NOTHING: RemovalCheckResult = {
  uncommittedFiles: 0,
  unpushedCommits: 0,
  stashes: 0,
  mergeInProgress: false,
  unreadable: false
};

/** git could not read the working copy, so nothing proves that there is nothing to lose. */
const UNREADABLE: RemovalCheckResult = { ...NOTHING, unreadable: true };

/**
 * What removing a repository would lose, so that the remove dialog asks for
 * one click or for the typed name (RM-18). Read-only and outside the
 * working-tree lock: it never changes the repository's status, not even for a
 * working copy that git finds damaged.
 */
@Injectable()
export class RemovalCheck {
  private readonly logger = new Logger(RemovalCheck.name);

  constructor(
    private readonly queries: RepositoryQueries,
    private readonly engine: GitEngine,
    @Inject(DATA_LAYOUT) private readonly layout: DataLayout
  ) {}

  /**
   * The user's repository's unsaved work. A repository being cloned, or whose
   * clone failed, has none; one whose working copy is missing or damaged is
   * unreadable, as is one that git fails to read here, a timeout included.
   *
   * @throws ApiErrorException `404 not-found`, also for another user's repository (RM-1).
   */
  async of(userId: number, repositoryId: number): Promise<RemovalCheckResult> {
    const row = ownRow(this.queries.find(userId, repositoryId));
    if (row.status === 'error' && row.errorCode === 'working-copy-missing') {
      return UNREADABLE;
    }
    if (row.status !== 'ready') {
      return NOTHING;
    }
    try {
      return { ...await this.engine.unsavedWork(this.layout.workingCopy(userId, repositoryId)), unreadable: false };
    } catch (error) {
      this.logger.warn(`Could not read the working copy of repository ${repositoryId}: ${errorForLog(error)}`);
      return UNREADABLE;
    }
  }
}
