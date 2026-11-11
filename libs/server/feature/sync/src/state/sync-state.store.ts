import { DATABASE, Database, SyncState, syncState } from '@front-burner/server-core-database';
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

  /** A merge starts: the record moves to the `earlier_` columns, and the commit before the merge is recorded. */
  startMerge(repositoryId: number, recordedCommit: string): void {
    const current = this.row(repositoryId);
    const set = {
      recordedCommit,
      mergeCommit: null,
      earlierRecordedCommit: current?.recordedCommit ?? null,
      earlierMergeCommit: current?.mergeCommit ?? null,
      mergeApplying: true
    };
    this.database.db.insert(syncState).values({ repositoryId, ...set })
      .onConflictDoUpdate({ target: syncState.repositoryId, set }).run();
  }

  /** The merge stopped without a commit (a conflict waits for the user): the record stays. */
  mergeStopped(repositoryId: number): void {
    this.change(repositoryId, { mergeApplying: false });
  }

  /**
   * The merge was committed: its commit joins the record, and the earlier record
   * is dropped. With `recordedCommit`, the record is written whole, also for a
   * repository with no row: for a record that only `PRE_MERGE_REF` still had.
   */
  mergeCommitted(repositoryId: number, mergeCommit: string, recordedCommit?: string): void {
    const set = {
      mergeCommit,
      mergeApplying: false,
      earlierRecordedCommit: null,
      earlierMergeCommit: null
    };
    if (recordedCommit === undefined) {
      this.change(repositoryId, set);
      return;
    }
    this.database.db.insert(syncState).values({ repositoryId, recordedCommit, ...set })
      .onConflictDoUpdate({ target: syncState.repositoryId, set: { recordedCommit, ...set } }).run();
  }

  /** Puts the earlier record back; returns the recorded commit now in place, or `null` when there is none. */
  restoreEarlier(repositoryId: number): string | null {
    const current = this.row(repositoryId);
    const recordedCommit = current?.earlierRecordedCommit ?? null;
    this.change(repositoryId, {
      recordedCommit,
      mergeCommit: current?.earlierMergeCommit ?? null,
      earlierRecordedCommit: null,
      earlierMergeCommit: null,
      mergeApplying: false
    });
    return recordedCommit;
  }

  /** The commit recorded before the last merge, the merge commit it belongs to, and whether a merge is being applied. */
  record(repositoryId: number): { recordedCommit: string | null; mergeCommit: string | null; applying: boolean; } {
    const row = this.row(repositoryId);
    return {
      recordedCommit: row?.recordedCommit ?? null,
      mergeCommit: row?.mergeCommit ?? null,
      applying: row?.mergeApplying ?? false
    };
  }

  /** The commit recorded before the merge that came before this one, or `null`. */
  earlierRecordedCommit(repositoryId: number): string | null {
    return this.row(repositoryId)?.earlierRecordedCommit ?? null;
  }

  /** Forgets the record altogether. */
  forgetRecord(repositoryId: number): void {
    this.change(repositoryId, {
      recordedCommit: null,
      mergeCommit: null,
      earlierRecordedCommit: null,
      earlierMergeCommit: null,
      mergeApplying: false
    });
  }

  private row(repositoryId: number): SyncState | undefined {
    return this.database.db.select().from(syncState).where(eq(syncState.repositoryId, repositoryId)).get();
  }

  /** Changes the row of a repository that has one; a repository without a row has no record to change. */
  private change(repositoryId: number, set: Partial<Omit<SyncState, 'repositoryId'>>): void {
    this.database.db.update(syncState).set(set).where(eq(syncState.repositoryId, repositoryId)).run();
  }
}

function sorted(params: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(params).sort(([ a ], [ b ]) => a.localeCompare(b)));
}
