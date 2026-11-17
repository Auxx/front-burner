import { join } from 'node:path';

/** The token of the instance's `DataLayout`. */
export const DATA_LAYOUT = 'FRONT_BURNER_DATA_LAYOUT';

/**
 * Where things live in the data directory (NF-5.1, NF-5.2). The working
 * copies, `tmp/` and `orphans/` live under the repositories root, which is the
 * data directory unless `FRONT_BURNER_REPOS_DIR` names another (NF-5.4); `tmp/`
 * is beside `repos/`, so a finished clone moves into place with one rename
 * (NF-5.3).
 */
export class DataLayout {
  /** The working copies, one folder per user and repository. */
  readonly reposDir: string;
  /** Half-finished work such as a running clone; emptied on every start. */
  readonly tmpDir: string;
  /** Working copies whose repository no longer exists, moved aside on start (NF-6.4). */
  readonly orphansDir: string;

  constructor(dataDir: string, reposRoot = dataDir) {
    this.reposDir = join(reposRoot, 'repos');
    this.tmpDir = join(reposRoot, 'tmp');
    this.orphansDir = join(reposRoot, 'orphans');
  }

  /** `repos/<user-id>/<repo-id>`: IDs, never names, so that a rename moves nothing. */
  workingCopy(userId: number, repositoryId: number): string {
    return join(this.reposDir, String(userId), String(repositoryId));
  }
}
