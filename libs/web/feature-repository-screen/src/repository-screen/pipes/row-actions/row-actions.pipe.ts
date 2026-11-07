import { Pipe, PipeTransform } from '@angular/core';

import type { TreeEntry } from '../../models/tree-entry.model';
import { type EntryAction, entryActions } from '../../utils/entry-actions/entry-actions';

/** The actions of a file tree row (FB-24): none for an added row or an entry being deleted (FB-40). */
@Pipe({ name: 'rowActions' })
export class RowActionsPipe implements PipeTransform {
  transform(row: TreeEntry): EntryAction[] {
    return rowActions(row);
  }
}

export function rowActions(row: TreeEntry): EntryAction[] {
  return row.entry && !row.deleting ? entryActions(row.entry) : [];
}
