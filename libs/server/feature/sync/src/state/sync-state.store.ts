import { DATABASE, Database, SyncState, syncState } from '@front-burner/server-core-database';
import { GitProblemState } from '@front-burner/shared-contracts';
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

/** A kind of operation with the remote, as RM-8 tells them apart: a pull is a fetch's kind. */
export type RemoteOperation = 'fetch' | 'push';

/** The warnings that the operations with the remote left (RM-8); each `null` when there is none. */
export interface RemoteProblems {
  /** Of the last fetch or pull that had one. */
  fetch: GitProblemState | null;
  /** Of the last push that had one. */
  push: GitProblemState | null;
}

/** The codes kept as warnings, per kind (RM-8): only a push can be not allowed. */
const WARNINGS: Record<RemoteOperation, ReadonlySet<string>> = {
  fetch: new Set([ 'credentials-refused', 'host-key-changed' ]),
  push: new Set([ 'credentials-refused', 'push-not-allowed', 'host-key-changed' ])
};

/** What is remembered per repository between synchronisations (A-4.2). */
@Injectable()
export class SyncStateStore {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /** The problem of the last fetch, or `null` when it had none. */
  fetchProblem(repositoryId: number): GitProblemState | null {
    return parsed(this.row(repositoryId)?.fetchProblem);
  }

  /** Stores the fetch problem (`null` clears it); true when the stored value changed. */
  setFetchProblem(repositoryId: number, problem: GitProblemState | null): boolean {
    return this.setProblem(repositoryId, 'fetchProblem', problem);
  }

  /** The warning a push left (RM-8), or `null`. */
  pushProblem(repositoryId: number): GitProblemState | null {
    return parsed(this.row(repositoryId)?.pushProblem);
  }

  /** Stores the push's warning (`null` clears it); true when the stored value changed. */
  setPushProblem(repositoryId: number, problem: GitProblemState | null): boolean {
    return this.setProblem(repositoryId, 'pushProblem', problem);
  }

  /** The warnings left by fetches and pulls, and by pushes (RM-8). */
  remoteProblems(repositoryId: number): RemoteProblems {
    const row = this.row(repositoryId);
    return { fetch: parsed(row?.fetchWarning), push: parsed(row?.pushProblem) };
  }

  /**
   * An operation with the remote failed. Only a warning of RM-8 is kept, and it
   * replaces the last one of its kind; any other failure, such as the network,
   * proves nothing fixed and changes nothing. A pull counts as a fetch, since it
   * fetches first. True when a stored value changed.
   */
  remoteFailed(repositoryId: number, kind: RemoteOperation, problem: GitProblemState): boolean {
    if (!WARNINGS[kind].has(problem.code)) {
      return false;
    }
    return this.setProblem(repositoryId, kind === 'push' ? 'pushProblem' : 'fetchWarning', problem);
  }

  /**
   * An operation with the remote succeeded: a fetch's or pull's warning goes
   * whatever succeeded, and a push's only when a push did (RM-8). True when a
   * stored value changed.
   */
  remoteSucceeded(repositoryId: number, kind: RemoteOperation): boolean {
    const fetchCleared = this.setProblem(repositoryId, 'fetchWarning', null);
    const pushCleared = kind === 'push' && this.setProblem(repositoryId, 'pushProblem', null);
    return fetchCleared || pushCleared;
  }

  /** The repository's credentials changed: "Can't push with these credentials" goes (RM-8). True when it was stored. */
  credentialsChanged(repositoryId: number): boolean {
    return this.pushProblem(repositoryId)?.code === 'push-not-allowed' && this.setPushProblem(repositoryId, null);
  }

  private setProblem(
    repositoryId: number,
    column: 'fetchProblem' | 'fetchWarning' | 'pushProblem',
    problem: GitProblemState | null
  ): boolean {
    const json = problem === null ? null : JSON.stringify({ code: problem.code, params: sorted(problem.params) });
    if ((this.row(repositoryId)?.[column] ?? null) === json) {
      return false;
    }
    this.database.db.insert(syncState).values({ repositoryId, [column]: json })
      .onConflictDoUpdate({ target: syncState.repositoryId, set: { [column]: json } }).run();
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

function parsed(json: string | null | undefined): GitProblemState | null {
  return json ? (JSON.parse(json) as GitProblemState) : null;
}

function sorted(params: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(params).sort(([ a ], [ b ]) => a.localeCompare(b)));
}
