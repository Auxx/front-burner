import type { Entry, EntryKind } from '@front-burner/shared-contracts';
import type { TreeNode } from '@front-burner/ui';

/**
 * What a row of the file tree is: an entry, or one of the rows the tree adds
 * inside a folder: its loading state (FB-43), its error with **Try again**
 * (FB-44), the count of entries not listed (FB-18), or the note on an empty
 * folder (FB-33).
 */
export type TreeEntryKind = EntryKind | 'loading' | 'error' | 'more' | 'empty-note';

/**
 * One row of the file tree. An entry's `value` is its path; the other rows'
 * values are `'\u0000<kind>:<folder path>'`, which no path can be, since a
 * name never contains NUL (FB-27).
 */
export interface TreeEntry extends TreeNode {
  readonly kind: TreeEntryKind;
  /** The listed entry; only for entries. */
  readonly entry?: Entry;
  /** An entry's path, or the path of the folder an added row is in. */
  readonly path: string;
  /** Whether the entry is being deleted (FB-40): it shows "Deleting…" and has no actions. */
  readonly deleting?: boolean;
  readonly children?: readonly TreeEntry[];
}
