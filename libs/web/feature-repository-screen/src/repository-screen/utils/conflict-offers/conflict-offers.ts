import type { GitConflictFile, GitConflictKind, GitResolution } from '@front-burner/shared-contracts';

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
