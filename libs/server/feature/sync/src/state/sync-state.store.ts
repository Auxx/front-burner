import { DATABASE, Database, syncState } from '@front-burner/server-core-database';
import { GitProblemState } from '@front-burner/shared-contracts';
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

/** What is remembered per repository between synchronisations (A-4.2). */
@Injectable()
export class SyncStateStore {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /** The problem of the last fetch, or `null` when it had none. */
  fetchProblem(repositoryId: number): GitProblemState | null {
    const row = this.database.db.select().from(syncState).where(eq(syncState.repositoryId, repositoryId)).get();
    return row?.fetchProblem ? (JSON.parse(row.fetchProblem) as GitProblemState) : null;
  }

  /** Stores the fetch problem (`null` clears it); true when the stored value changed. */
  setFetchProblem(repositoryId: number, problem: GitProblemState | null): boolean {
    const json = problem === null ? null : JSON.stringify({ code: problem.code, params: sorted(problem.params) });
    const current = this.database.db.select().from(syncState).where(eq(syncState.repositoryId, repositoryId)).get();
    if ((current?.fetchProblem ?? null) === json) {
      return false;
    }
    this.database.db.insert(syncState).values({ repositoryId, fetchProblem: json })
      .onConflictDoUpdate({ target: syncState.repositoryId, set: { fetchProblem: json } }).run();
    return true;
  }
}

function sorted(params: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(params).sort(([ a ], [ b ]) => a.localeCompare(b)));
}
