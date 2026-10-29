import type { Entry } from '@front-burner/shared-contracts';

/** What can be done to an entry from the file tree (FB-24). */
export type EntryAction = 'new-file' | 'new-folder' | 'rename' | 'delete';

/**
 * The actions allowed for `entry`, in menu order (FB-24, FB-25, FB-35,
 * FB-37): a folder creates inside itself, a Markdown file and a folder can be
 * renamed, and everything but a submodule can be deleted.
 */
export function entryActions(entry: Entry): EntryAction[] {
  switch (entry.kind) {
    case 'folder':
      return [ 'new-file', 'new-folder', 'rename', 'delete' ];
    case 'file':
      return entry.markdown ? [ 'rename', 'delete' ] : [ 'delete' ];
    case 'symlink':
      return [ 'delete' ];
    default:
      return [];
  }
}
