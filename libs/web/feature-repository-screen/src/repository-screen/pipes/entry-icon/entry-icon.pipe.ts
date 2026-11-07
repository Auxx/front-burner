import { Pipe, PipeTransform } from '@angular/core';
import type { IconName } from '@front-burner/ui';

import type { TreeEntry } from '../../models/tree-entry.model';

/** The icon of a file tree entry's kind, with Markdown files told apart (FB-20). */
@Pipe({ name: 'entryIcon' })
export class EntryIconPipe implements PipeTransform {
  transform(row: TreeEntry): IconName {
    switch (row.kind) {
      case 'folder':
        return 'folder';
      case 'symlink':
        return 'file-symlink-file';
      case 'submodule':
        return 'file-submodule';
      default:
        return row.entry?.markdown ? 'markdown' : 'file';
    }
  }
}
