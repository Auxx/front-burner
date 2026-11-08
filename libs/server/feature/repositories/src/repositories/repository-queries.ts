import { DATABASE, Database, repositories, Repository } from '@front-burner/server-core-database';
import type { RepositoryIndex, RepositorySummary } from '@front-burner/shared-contracts';
import { remoteDisplay } from '@front-burner/shared-util';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';

/** Reads a user's repositories; every query is limited to that user (DS-3, A-7.3). */
@Injectable()
export class RepositoryQueries {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /** Every repository's name and remote, for the Add repository form's early checks (AR-12, AR-15). */
  index(userId: number): RepositoryIndex {
    const rows = this.database.db.select({ name: repositories.name, remoteUrl: repositories.remoteUrl })
      .from(repositories)
      .where(eq(repositories.userId, userId))
      .orderBy(asc(repositories.id))
      .all();
    // The display form is the remote's key for every URL that parses (AR-12, DS-18).
    return { repositories: rows.map(row => ({ name: row.name, remoteKey: remoteDisplay(row.remoteUrl) })) };
  }

  /** One of the user's repositories; another user's is not found, like a missing one (FB-2). */
  find(userId: number, id: number): Repository | undefined {
    return this.database.db.select().from(repositories)
      .where(and(eq(repositories.id, id), eq(repositories.userId, userId)))
      .get();
  }

  /**
   * Records that the user opened the repository in the editor, only when it is
   * `ready` (DS-8, DS-9, FB-11). Returns the row either way, for its status (FB-3).
   */
  markOpened(userId: number, id: number, now: Date): Repository | undefined {
    this.database.db.update(repositories)
      .set({ lastAccessedAt: now })
      .where(and(eq(repositories.id, id), eq(repositories.userId, userId), eq(repositories.status, 'ready')))
      .run();
    return this.find(userId, id);
  }

  /**
   * The dashboard's list: most recently accessed first, ties by name ignoring
   * case (DS-16, DS-17). `exclude` leaves one out before the limit, so the
   * switcher still gets ten others (NV-10); another user's ID changes nothing.
   */
  recent(userId: number, limit = 10, exclude?: number): Repository[] {
    const own = eq(repositories.userId, userId);
    return this.database.db.select().from(repositories)
      .where(exclude === undefined ? own : and(own, ne(repositories.id, exclude)))
      .orderBy(desc(repositories.lastAccessedAt), asc(sql`lower(${repositories.name})`), asc(repositories.id))
      .limit(limit)
      .all();
  }
}

/** A repository as clients see it: the remote without credentials (DS-19). */
export function toSummary(row: Repository): RepositorySummary {
  return {
    id: row.id,
    name: row.name,
    remote: remoteDisplay(row.remoteUrl),
    status: row.status,
    error: row.errorCode,
    // Recorded once the git engine reports operations with the remote (REQ-REPO-002).
    warnings: [],
    lastAccessedAt: row.lastAccessedAt.toISOString()
  };
}
