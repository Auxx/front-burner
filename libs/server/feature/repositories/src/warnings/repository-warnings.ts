import { DATABASE, Database, Repository, savedCredentials } from '@front-burner/server-core-database';
import { KeyUnlockStore } from '@front-burner/server-feature-credentials';
import type { RepositoryWarning } from '@front-burner/shared-contracts';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { RemoteProblems, RemoteProblemsSource } from './remote-problems-source';

/**
 * Computes a repository's warnings for the session that asks (RM-8). The
 * first three come from the stored problems of the operations with the remote;
 * "Key locked" from the session's unlocks, which live in memory only, so after
 * a restart every passphrase-protected key is locked (RC-15).
 */
@Injectable()
export class RepositoryWarnings {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly problems: RemoteProblemsSource,
    private readonly unlocks: KeyUnlockStore
  ) {}

  /**
   * The warnings of each row, by repository ID, in the order of RM-8's table.
   * Only a `ready` repository has warnings: a failed clone shows its error
   * (RM-6). Reads the stored problems and the keys once for all rows (NF-2).
   */
  forRows(sessionId: string, rows: readonly Repository[]): Map<number, RepositoryWarning[]> {
    const ready = rows.filter(row => row.status === 'ready');
    const problems = this.problems.read(ready.map(row => row.id));
    const protectedKeys = this.protectedKeys(ready);
    return new Map(rows.map(row => [
      row.id,
      row.status === 'ready'
        ? warningsOf(
          problems.get(row.id),
          row.credentialId !== null && protectedKeys.has(row.credentialId)
            && !this.unlocks.isUnlocked(sessionId, row.credentialId)
        )
        : []
    ]));
  }

  /** The warnings of one row. */
  forRow(sessionId: string, row: Repository): RepositoryWarning[] {
    return this.forRows(sessionId, [ row ]).get(row.id) ?? [];
  }

  /** The IDs of the rows' saved credentials that are passphrase-protected SSH keys. */
  private protectedKeys(rows: readonly Repository[]): Set<number> {
    const ids = [ ...new Set(rows.flatMap(row => (row.credentialId === null ? [] : [ row.credentialId ]))) ];
    if (ids.length === 0) {
      return new Set();
    }
    const found = this.database.db.select({ id: savedCredentials.id }).from(savedCredentials)
      .where(and(
        inArray(savedCredentials.id, ids),
        eq(savedCredentials.kind, 'ssh-key'),
        eq(savedCredentials.sshPassphraseProtected, true)
      ))
      .all();
    return new Set(found.map(row => row.id));
  }
}

/** RM-8's mapping, in the order of its table, each warning once. */
function warningsOf(problems: RemoteProblems | undefined, keyLocked: boolean): RepositoryWarning[] {
  const codes = new Set([ problems?.fetch?.code, problems?.push?.code ]);
  const warnings: RepositoryWarning[] = [];
  if (codes.has('credentials-refused')) {
    warnings.push('credentials-refused');
  }
  if (problems?.push?.code === 'push-not-allowed') {
    warnings.push('cannot-push');
  }
  if (codes.has('host-key-changed')) {
    warnings.push('host-key-changed');
  }
  if (keyLocked) {
    warnings.push('key-locked');
  }
  return warnings;
}
