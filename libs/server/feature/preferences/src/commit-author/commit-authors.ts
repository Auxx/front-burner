import {
  DATABASE,
  Database,
  repositories,
  type UserPreferences,
  userPreferences
} from '@front-burner/server-core-database';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { RepositoryQueries } from '@front-burner/server-feature-repositories';
import {
  type CommitAuthor,
  type CommitAuthorPreference,
  CommitAuthorSchema,
  type RepositoryCommitAuthor
} from '@front-burner/shared-contracts';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { ZodValidationException } from 'nestjs-zod';

function toPreference(row: UserPreferences): CommitAuthorPreference {
  return {
    author: { name: row.commitAuthorName, email: row.commitAuthorEmail },
    confirmed: row.commitAuthorConfirmed
  };
}

/**
 * Manages user-level default commit authors and repository-level overrides
 * (A-4.4, REQ-GIT-001).
 */
@Injectable()
export class CommitAuthors {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly repositoryQueries: RepositoryQueries
  ) {}

  /** The default commit author and its confirmation state (CA-7, CA-12, CA-13). */
  preference(userId: number): CommitAuthorPreference {
    return toPreference(this.loadPreferences(userId));
  }

  /**
   * Sets the default commit author and marks it confirmed (CA-9, CA-12, CA-13).
   * Editing on the Preferences page counts as confirmation.
   */
  setDefault(userId: number, author: CommitAuthor): CommitAuthorPreference {
    const updated = this.database.db.update(userPreferences)
      .set({
        commitAuthorName: author.name,
        commitAuthorEmail: author.email,
        commitAuthorConfirmed: true
      })
      .where(eq(userPreferences.userId, userId))
      .returning()
      .get();
    if (updated === undefined) {
      throw new ApiErrorException(404, 'not-found');
    }
    return toPreference(updated);
  }

  /**
   * Confirms the default commit author before first commit (CA-12, CA-13). A
   * default that breaks CA-10 is refused next to its field, as it could not be
   * used for a commit; the user has to change it first.
   */
  confirm(userId: number): void {
    const { author } = this.preference(userId);
    const checked = CommitAuthorSchema.safeParse(author);
    if (!checked.success) {
      throw new ZodValidationException(checked.error);
    }
    this.database.db.update(userPreferences)
      .set({ commitAuthorConfirmed: true })
      .where(eq(userPreferences.userId, userId))
      .run();
  }

  /**
   * The commit author for this repository: override if set, otherwise default
   * (CA-6, CA-8, CA-12). Another user's repository yields 404 not-found (AC-GIT-001.11).
   */
  forRepository(userId: number, repositoryId: number): RepositoryCommitAuthor {
    const repo = this.repositoryQueries.find(userId, repositoryId);
    if (repo === undefined) {
      throw new ApiErrorException(404, 'not-found');
    }
    const { author, confirmed } = this.preference(userId);
    if (repo.commitAuthorName !== null && repo.commitAuthorEmail !== null) {
      return {
        author: { name: repo.commitAuthorName, email: repo.commitAuthorEmail },
        source: 'override',
        confirmed
      };
    }
    return { author, source: 'default', confirmed };
  }

  /**
   * Sets a repository override (CA-8, CA-9). Does not mark the default author
   * confirmed (CA-12).
   */
  setOverride(userId: number, repositoryId: number, author: CommitAuthor): RepositoryCommitAuthor {
    return this.writeOverride(userId, repositoryId, author.name, author.email);
  }

  /** Clears a repository override, reverting to the default author (CA-8, CA-9). */
  removeOverride(userId: number, repositoryId: number): RepositoryCommitAuthor {
    return this.writeOverride(userId, repositoryId, null, null);
  }

  private writeOverride(
    userId: number,
    repositoryId: number,
    commitAuthorName: string | null,
    commitAuthorEmail: string | null
  ): RepositoryCommitAuthor {
    const updated = this.database.db.update(repositories)
      .set({ commitAuthorName, commitAuthorEmail })
      .where(and(eq(repositories.id, repositoryId), eq(repositories.userId, userId)))
      .run();
    if (updated.changes === 0) {
      throw new ApiErrorException(404, 'not-found');
    }
    return this.forRepository(userId, repositoryId);
  }

  private loadPreferences(userId: number): UserPreferences {
    const pref = this.database.db.select().from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .get();
    if (pref === undefined) {
      throw new ApiErrorException(404, 'not-found');
    }
    return pref;
  }
}
