import { Pipe, PipeTransform } from '@angular/core';
import type { TreeNode } from '@front-burner/ui';

import type { TreeEntry } from '../../models/tree-entry.model';

/** A file tree row as the store made it: `ui-tree` hands its rows back as plain nodes. */
@Pipe({ name: 'treeEntry' })
export class TreeEntryPipe implements PipeTransform {
  transform(node: TreeNode): TreeEntry {
    return node as TreeEntry;
  }
}
