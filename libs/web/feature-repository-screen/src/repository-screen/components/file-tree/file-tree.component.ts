import { ChangeDetectionStrategy, Component, inject, input, output, viewChild } from '@angular/core';
import {
  IconButtonComponent,
  IconComponent,
  type IconName,
  SpinnerComponent,
  TooltipDirective,
  TreeComponent,
  type TreeNode,
  TreeNodeDirective
} from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

import type { TreeEntry } from '../../models/tree-entry.model';
import { FileTreeStoreService } from '../../services/file-tree-store/file-tree-store.service';

/**
 * The file tree of the repository screen (REQ-FILE-001): the rows of the
 * page's `FileTreeStoreService` in a `ui-tree` (FB-46). Each entry shows an icon for
 * its kind, with Markdown files told apart (FB-20); an ignored entry shows its
 * name in the ignored colour and an icon that explains it on hover, on the
 * keyboard's active row and on tap, without selecting the row (FB-20a).
 *
 * Selecting a file, symbolic link or submodule emits its path as `selectPath`;
 * folders expand and collapse (FB-22). Selecting a folder's error row emits the
 * folder as `retry` (FB-44) and leaves the selection as it was.
 */
@Component({
  selector: 'rs-file-tree',
  imports: [
    TranslocoDirective,
    IconButtonComponent,
    IconComponent,
    SpinnerComponent,
    TooltipDirective,
    TreeComponent,
    TreeNodeDirective
  ],
  templateUrl: './file-tree.component.html',
  styleUrl: './file-tree.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class FileTreeComponent {
  /** The open entry's path, highlighted in the tree (FB-14). */
  readonly selected = input<string | null>(null);

  readonly selectPath = output<string>();
  readonly retry = output<string>();

  protected readonly store = inject(FileTreeStoreService);
  private readonly tree = viewChild.required(TreeComponent);
  /** Set while the selection is put back after the error row was selected. */
  private restoring = false;

  /** The rows are the store's; `ui-tree` hands them back as plain nodes. */
  protected row(node: TreeNode): TreeEntry {
    return node as TreeEntry;
  }

  protected icon(row: TreeEntry): IconName {
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

  protected onSelected(value: string | null): void {
    const row = value === null || this.restoring ? undefined : this.find(this.store.nodes(), value);
    if (!row) {
      return;
    }
    if (row.kind === 'error') {
      // `ui-tree` selected the error row itself; the open file stays selected.
      this.restoring = true;
      this.tree().selected.set(this.selected());
      this.restoring = false;
      this.retry.emit(row.path);
    } else {
      this.selectPath.emit(row.path);
    }
  }

  private find(rows: readonly TreeEntry[], value: string): TreeEntry | undefined {
    for (const row of rows) {
      const found = row.value === value ? row : this.find(row.children ?? [], value);
      if (found) {
        return found;
      }
    }
    return undefined;
  }
}
