import type { Entry } from '@front-burner/shared-contracts';

/** What can be done to an entry from the file tree (FB-24). */
export type EntryAction = 'new-file' | 'new-folder' | 'rename' | 'delete';

/**
 * The actions allowed for `entry`, in menu order (FB-24, FB-25, FB-35): a
 * folder creates inside itself and can be renamed, a Markdown file can be
 * renamed, and nothing else has actions yet. **Delete** comes with plan 20.
 */
export function entryActions(entry: Entry): EntryAction[] {
  switch (entry.kind) {
    case 'folder':
      return [ 'new-file', 'new-folder', 'rename' ];
    case 'file':
      return entry.markdown ? [ 'rename' ] : [];
    default:
      return [];
  }
}
