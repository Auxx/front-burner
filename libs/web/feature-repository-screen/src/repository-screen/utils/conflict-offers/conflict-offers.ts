import {
  EDITABLE_FILE_LIMIT,
  type GitConflictFile,
  type GitConflictKind,
  type GitResolution
} from '@front-burner/shared-contracts';
import { isMarkdownName } from '@front-burner/shared-util';

import { fileName } from '../file-name/file-name';

/** The whole versions each kind offers (GC-15, GC-16, D-6.2). */
const OFFERS: Record<GitConflictKind, readonly GitResolution[]> = {
  'both-changed': [ 'ours', 'theirs' ],
  'both-added': [ 'ours', 'theirs' ],
  'deleted-by-us': [ 'keep', 'delete' ],
  'deleted-by-them': [ 'keep', 'delete' ]
};

/**
 * The ways to resolve `file` with a whole version, in the order they are
 * offered (GC-8, GC-15, GC-16): **Use my version** and **Use their version** for
 * a file both sides changed or added, **Keep the file** and **Delete the file**
 * for one that a side deleted. Nothing for a resolved file. **Mark as resolved**
 * belongs to the editor, and is not one of these.
 */
export function conflictOffers(file: GitConflictFile): GitResolution[] {
  return file.resolved ? [] : [ ...OFFERS[file.kind] ];
}

/** A side of a conflicting file whose version can be shown. */
export type VersionSide = 'ours' | 'theirs';

/**
 * The versions of `file` that **Show mine** and **Show theirs** can open, in that
 * order (GC-17): those of a Markdown file that exist and are at most the editor's
 * limit (ED-2), resolved or not. A side without a size, deleted or not a regular
 * file, has no button; the size shown is enough.
 */
export function shownVersions(file: GitConflictFile): VersionSide[] {
  if (!isMarkdownName(fileName(file.path))) {
    return [];
  }
  const shown = (size: number | null) => size !== null && size <= EDITABLE_FILE_LIMIT;
  return [
    ...(shown(file.oursSize) ? [ 'ours' as const ] : []),
    ...(shown(file.theirsSize) ? [ 'theirs' as const ] : [])
  ];
}
