import { join } from 'node:path';

/** The token of the instance's `DataLayout`. */
export const DATA_LAYOUT = 'FRONT_BURNER_DATA_LAYOUT';

/** Where things live in the data directory (NF-5.1, NF-5.2). */
export class DataLayout {
  /** The working copies, one folder per user and repository. */
  readonly reposDir: string;
  /** Half-finished work such as a running clone; emptied on every start. */
  readonly tmpDir: string;

  constructor(dataDir: string) {
    this.reposDir = join(dataDir, 'repos');
    this.tmpDir = join(dataDir, 'tmp');
  }

  /** `repos/<user-id>/<repo-id>`: IDs, never names, so that a rename moves nothing. */
  workingCopy(userId: number, repositoryId: number): string {
    return join(this.reposDir, String(userId), String(repositoryId));
  }
}
