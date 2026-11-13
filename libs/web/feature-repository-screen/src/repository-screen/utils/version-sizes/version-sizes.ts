import type { GitConflictFile } from '@front-burner/shared-contracts';

import { formatSize } from '../file-size/file-size';

/** One version of a conflicting file and its size (GC-17). */
export interface VersionSize {
  side: 'mine' | 'theirs';
  /**
   * Formatted, such as `1.5 KB`; `deleted` when this side deleted the file;
   * `none` when the version exists without a size, such as a submodule.
   */
  size: string;
}

function sizeOf(bytes: number | null, deleted: boolean): string {
  if (bytes !== null) {
    return formatSize(bytes);
  }
  return deleted ? 'deleted' : 'none';
}

/** The size of my version and of theirs, in that order (GC-17). */
export function versionSizes(file: GitConflictFile): VersionSize[] {
  return [
    { side: 'mine', size: sizeOf(file.oursSize, file.kind === 'deleted-by-us') },
    { side: 'theirs', size: sizeOf(file.theirsSize, file.kind === 'deleted-by-them') }
  ];
}
