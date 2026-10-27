import { DATABASE, Database, repositories, Repository } from '@front-burner/server-core-database';
import type { RepositorySummary } from '@front-burner/shared-contracts';
import { remoteDisplay } from '@front-burner/shared-util';
import { Inject, Injectable } from '@nestjs/common';
import { asc, desc, eq, sql } from 'drizzle-orm';

/** Reads a user's repositories; every query is limited to that user (DS-3, A-7.3). */
@Injectable()
export class RepositoryQueries {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /** The dashboard's list: most recently accessed first, ties by name ignoring case (DS-16, DS-17). */
  recent(userId: number, limit = 10): Repository[] {
    return this.database.db.select().from(repositories)
      .where(eq(repositories.userId, userId))
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
