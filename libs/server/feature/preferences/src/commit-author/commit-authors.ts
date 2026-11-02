import { DATABASE, Database, repositories, userPreferences } from '@front-burner/server-core-database';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { RepositoryQueries } from '@front-burner/server-feature-repositories';
import type { CommitAuthor, CommitAuthorPreference, RepositoryCommitAuthor } from '@front-burner/shared-contracts';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

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
    const pref = this.loadPreferences(userId);
    return {
      author: {
        name: pref.commitAuthorName,
        email: pref.commitAuthorEmail
      },
      confirmed: Boolean(pref.commitAuthorConfirmed)
    };
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
    return {
      author: {
        name: updated.commitAuthorName,
        email: updated.commitAuthorEmail
      },
      confirmed: Boolean(updated.commitAuthorConfirmed)
    };
  }

  /** Confirms the default commit author before first commit (CA-12, CA-13). */
  confirm(userId: number): void {
    const updated = this.database.db.update(userPreferences)
      .set({ commitAuthorConfirmed: true })
      .where(eq(userPreferences.userId, userId))
      .run();
    if (updated.changes === 0) {
      throw new ApiErrorException(404, 'not-found');
    }
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
    const pref = this.loadPreferences(userId);
    if (repo.commitAuthorName !== null && repo.commitAuthorEmail !== null) {
      return {
        author: {
          name: repo.commitAuthorName,
          email: repo.commitAuthorEmail
        },
        source: 'override',
        confirmed: Boolean(pref.commitAuthorConfirmed)
      };
    }
    return {
      author: {
        name: pref.commitAuthorName,
        email: pref.commitAuthorEmail
      },
      source: 'default',
      confirmed: Boolean(pref.commitAuthorConfirmed)
    };
  }

  /**
   * Sets a repository override (CA-8, CA-9). Does not mark the default author
   * confirmed (CA-12).
   */
  setOverride(userId: number, repositoryId: number, author: CommitAuthor): RepositoryCommitAuthor {
    const repo = this.repositoryQueries.find(userId, repositoryId);
    if (repo === undefined) {
      throw new ApiErrorException(404, 'not-found');
    }
    this.database.db.update(repositories)
      .set({
        commitAuthorName: author.name,
        commitAuthorEmail: author.email
      })
      .where(and(eq(repositories.id, repositoryId), eq(repositories.userId, userId)))
      .run();
    const pref = this.loadPreferences(userId);
    return {
      author: {
        name: author.name,
        email: author.email
      },
      source: 'override',
      confirmed: Boolean(pref.commitAuthorConfirmed)
    };
  }

  /**
   * Clears a repository override, reverting to the default author (CA-8, CA-9).
   */
  removeOverride(userId: number, repositoryId: number): RepositoryCommitAuthor {
    const repo = this.repositoryQueries.find(userId, repositoryId);
    if (repo === undefined) {
      throw new ApiErrorException(404, 'not-found');
    }
    this.database.db.update(repositories)
      .set({
        commitAuthorName: null,
        commitAuthorEmail: null
      })
      .where(and(eq(repositories.id, repositoryId), eq(repositories.userId, userId)))
      .run();
    const pref = this.loadPreferences(userId);
    return {
      author: {
        name: pref.commitAuthorName,
        email: pref.commitAuthorEmail
      },
      source: 'default',
      confirmed: Boolean(pref.commitAuthorConfirmed)
    };
  }

  private loadPreferences(userId: number) {
    const pref = this.database.db.select().from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .get();
    if (pref === undefined) {
      throw new ApiErrorException(404, 'not-found');
    }
    return pref;
  }
}
