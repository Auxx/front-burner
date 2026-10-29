import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild
} from '@angular/core';
import {
  IconButtonComponent,
  IconComponent,
  type IconName,
  MenuComponent,
  MenuItemComponent,
  MenuTriggerDirective,
  SpinnerComponent,
  TooltipDirective,
  TreeComponent,
  TreeItemMenuDirective,
  type TreeNode,
  TreeNodeDirective
} from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

import type { TreeEntry } from '../../models/tree-entry.model';
import { FileTreeStoreService } from '../../services/file-tree-store/file-tree-store.service';
import { type EntryAction, entryActions } from '../../utils/entry-actions/entry-actions';

/** An action chosen for an entry; `path` is `''` for the root folder (FB-25). */
export interface EntryActionRequest {
  readonly action: EntryAction;
  readonly path: string;
}

/**
 * The file tree of the repository screen (REQ-FILE-001): the rows of the
 * page's `FileTreeStoreService` in a `ui-tree` (FB-46). Each entry shows an icon for
 * its kind, with Markdown files told apart (FB-20); an ignored entry shows its
 * name in the ignored colour and an icon that explains it on hover, on the
 * keyboard's active row and on tap, without selecting the row (FB-20a).
 *
 * Selecting a file, symbolic link or submodule emits its path as `selectPath`,
 * also when it is the open one;
 * folders expand and collapse (FB-22). Selecting a folder's error row emits the
 * folder as `retry` (FB-44) and leaves the selection as it was.
 *
 * **New file** and **New folder** above the tree create in the root folder
 * (FB-25). Each entry with actions has an actions button, which also opens
 * from the keyboard on its row (Shift+F10, the ContextMenu key); all rows
 * share one menu, filled with the actions of the row that opened it (FB-24).
 * A chosen action is emitted as `action`. An entry being deleted shows
 * "Deleting…" in place of its actions (FB-40).
 *
 * The store's `focusRequest` focuses its entry's row, if the tree shows it
 * once the request is rendered (FB-32).
 */
@Component({
  selector: 'rs-file-tree',
  imports: [
    TranslocoDirective,
    IconButtonComponent,
    IconComponent,
    MenuComponent,
    MenuItemComponent,
    MenuTriggerDirective,
    SpinnerComponent,
    TooltipDirective,
    TreeComponent,
    TreeItemMenuDirective,
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
  readonly action = output<EntryActionRequest>();

  protected readonly store = inject(FileTreeStoreService);
  private readonly tree = viewChild.required(TreeComponent);

  /** The row whose actions button opened the shared menu last. */
  protected readonly menuRow = signal<TreeEntry | null>(null);
  /** The actions of the menu's row as the tree shows it now, such as none once it is being deleted. */
  protected readonly menuActions = computed(() => {
    const row = this.menuRow();
    const shown = row ? this.find(this.store.nodes(), row.value) : undefined;
    return shown ? this.actions(shown) : [];
  });

  constructor() {
    // After rendering, so that the tree has the rows the store has now. Tried
    // once: a row that is not shown then must not take the focus later.
    afterRenderEffect(() => {
      const path = this.store.focusRequest();
      if (path !== null) {
        untracked(() => this.tree().focusRow(path));
        this.store.focusRequest.set(null);
      }
    });
  }

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

  /** A row was opened by click, tap or key, also the open file again (FB-9). */
  protected onActivated(value: string): void {
    const row = this.find(this.store.nodes(), value);
    if (!row) {
      return;
    }
    if (row.kind === 'error') {
      // `ui-tree` selected the error row itself; the open file stays selected.
      this.tree().selected.set(this.selected());
      this.retry.emit(row.path);
    } else {
      this.selectPath.emit(row.path);
    }
  }

  protected actions(row: TreeEntry): EntryAction[] {
    return row.entry && !row.deleting ? entryActions(row.entry) : [];
  }

  protected onMenuItem(action: EntryAction): void {
    const row = this.menuRow();
    if (row) {
      this.action.emit({ action, path: row.path });
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
