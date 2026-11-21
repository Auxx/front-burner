import {
  afterEveryRender,
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild
} from '@angular/core';
import { markPerformance } from '@front-burner/shared-util';
import {
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
} from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

import type { TreeEntry } from '../../models/tree-entry.model';
import { EntryIconPipe } from '../../pipes/entry-icon/entry-icon.pipe';
import { rowActions, RowActionsPipe } from '../../pipes/row-actions/row-actions.pipe';
import { TreeEntryPipe } from '../../pipes/tree-entry/tree-entry.pipe';
import { FileTreeStoreService } from '../../services/file-tree-store/file-tree-store.service';
import type { EntryAction } from '../../utils/entry-actions/entry-actions';

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
 *
 * Each time a folder's entries are shown, the tree sets the performance mark
 * `fb:tree-folder-shown` (A-8.17).
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
    TreeNodeDirective,
    EntryIconPipe,
    RowActionsPipe,
    TreeEntryPipe
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
    return shown ? rowActions(shown) : [];
  });

  /** The shown folders whose entries are not on the page yet, with their first row's label. */
  private readonly unmarked = new Map<string, string>();
  /** The shown folders whose `fb:tree-folder-shown` mark is set. */
  private readonly marked = new Set<string>();

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    afterRenderEffect(() => {
      this.findShownFolders(this.store.nodes(), this.store.expanded());
      untracked(() => this.markShownFolders(host));
    });
    // The tree renders its rows a frame later than the store has them (virtual scrolling).
    afterEveryRender(() => this.markShownFolders(host));

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

  protected onMenuItem(action: EntryAction): void {
    const row = this.menuRow();
    if (row) {
      this.action.emit({ action, path: row.path });
    }
  }

  /**
   * The folders now shown with their entries, the root and every expanded
   * folder inside expanded ones; a folder that is loading or failed is not.
   * Those not shown any more are forgotten, so that a folder expanded again
   * is marked again.
   */
  private findShownFolders(rows: readonly TreeEntry[], expanded: readonly string[]): void {
    const open = new Set(expanded);
    const shown = new Map<string, string>();
    const visit = (folder: string, children: readonly TreeEntry[]) => {
      const first = children[0];
      if (!first || first.kind === 'loading' || first.kind === 'error') {
        return;
      }
      shown.set(folder, first.accessibleName ?? first.label);
      for (const child of children) {
        if (child.kind === 'folder' && child.children && open.has(child.path)) {
          visit(child.path, child.children);
        }
      }
    };
    visit('', rows);
    for (const folder of [ ...this.marked, ...this.unmarked.keys() ]) {
      if (!shown.has(folder)) {
        this.marked.delete(folder);
        this.unmarked.delete(folder);
      }
    }
    for (const [ folder, label ] of shown) {
      if (!this.marked.has(folder)) {
        this.unmarked.set(folder, label);
      }
    }
  }

  /**
   * Sets `fb:tree-folder-shown`, with the folder's path as its detail, once
   * the first entry of a shown folder is on the page (NF-2.1; read by
   * `perf-screen.mjs`).
   */
  private markShownFolders(host: HTMLElement): void {
    if (this.unmarked.size === 0) {
      return;
    }
    const labels = new Set(
      Array.from(host.querySelectorAll('[role="treeitem"]'), item => item.getAttribute('aria-label'))
    );
    for (const [ folder, label ] of this.unmarked) {
      if (labels.has(label)) {
        this.unmarked.delete(folder);
        this.marked.add(folder);
        markPerformance('fb:tree-folder-shown', { folder });
      }
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
