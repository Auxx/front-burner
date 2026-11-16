import type { Repository } from '@front-burner/server-core-database';
import { SavedCredentialsService } from '@front-burner/server-feature-credentials';
import type { RepositoryWarning } from '@front-burner/shared-contracts';
import { Injectable } from '@nestjs/common';
import { RemoteProblems, RemoteProblemsSource } from './remote-problems-source';

/** Who asks: the warnings are the user's, and "Key locked" depends on the session (RM-8). */
export interface WarningsViewer {
  userId: number;
  sessionId: string;
}

/**
 * Computes a repository's warnings for the session that asks (RM-8). The
 * first three come from the stored problems of the operations with the remote;
 * "Key locked" from the credentials feature, whose unlocks live in memory
 * only, so after a restart every passphrase-protected key is locked (RC-15).
 */
@Injectable()
export class RepositoryWarnings {
  constructor(private readonly problems: RemoteProblemsSource, private readonly saved: SavedCredentialsService) {}

  /**
   * The warnings of each row, in the rows' order, each in the order of RM-8's
   * table. Only a `ready` repository has warnings: a failed clone shows its
   * error (RM-6). Reads the stored problems and the keys once for all rows (NF-2).
   */
  forRows(viewer: WarningsViewer, rows: readonly Repository[]): RepositoryWarning[][] {
    const ready = rows.filter(row => row.status === 'ready');
    const problems = this.problems.read(ready.map(row => row.id));
    const lockedKeys = this.saved.lockedKeyIds(
      viewer.userId,
      viewer.sessionId,
      ready.flatMap(row => (row.credentialId === null ? [] : [ row.credentialId ]))
    );
    return rows.map(row =>
      row.status === 'ready'
        ? warningsOf(problems.get(row.id), row.credentialId !== null && lockedKeys.has(row.credentialId))
        : []
    );
  }

  /** The warnings of one row. */
  forRow(viewer: WarningsViewer, row: Repository): RepositoryWarning[] {
    return this.forRows(viewer, [ row ])[0];
  }

  /**
   * The stored problems that the row's warnings come from, with their params,
   * for the fixes on the settings page (RM-8, RC-21); none outside `ready`, as
   * for the warnings.
   */
  problemsOf(row: Repository): RemoteProblems {
    const stored = row.status === 'ready' ? this.problems.read([ row.id ]).get(row.id) : undefined;
    return { fetch: stored?.fetch ?? null, push: stored?.push ?? null };
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
