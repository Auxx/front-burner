import { FocusMonitor, type FocusOrigin } from '@angular/cdk/a11y';
import { Directionality } from '@angular/cdk/bidi';
import type { ListRange } from '@angular/cdk/collections';
import { CdkFixedSizeVirtualScroll, CdkVirtualForOf, CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChild,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
  viewChild
} from '@angular/core';

import { IconComponent } from '../../../content/components/icon/icon.component';
import { TreeNodeDirective } from '../../directives/tree-node/tree-node.directive';
import type { TreeNode } from '../../models/tree-node.model';

/** One visible row: a node with its place in the tree. */
interface TreeRow {
  readonly node: TreeNode;
  readonly level: number;
  readonly setsize: number;
  readonly posinset: number;
  readonly expanded: boolean;
  readonly expandable: boolean;
  readonly selectable: boolean;
  /** Index of the parent's row, or -1 at the root. */
  readonly parent: number;
}

/** The active row, remembered by value and by where it was. */
interface ActiveRow {
  readonly value: string;
  readonly index: number;
}

const FALLBACK_ROW_HEIGHT = 24;
const TYPEAHEAD_RESET_MS = 500;

let nextId = 0;

/**
 * A tree of folders and files (REQ-FILE-001): our own code on the CDK's virtual
 * scrolling (A-10.34), following the WAI-ARIA tree view pattern.
 *
 * ```html
 * <ui-tree label="Files" [nodes]="nodes" [(selected)]="open" [(expanded)]="expanded"
 *          (loadChildren)="load($event)">
 *   <ng-template uiTreeNode let-node>{{ node.label }}</ng-template>
 * </ui-tree>
 * ```
 *
 * - `[(selected)]` is the value of the open file; files are selectable and
 *   folders are not, unless a node says otherwise.
 * - `[(expanded)]` holds the values of the expanded folders, so that they can
 *   be restored (FB-14).
 * - `(loadChildren)` asks for the children of every visible folder that is
 *   expanded while its `children` is still undefined (FB-15), whether the user
 *   expanded it or `[expanded]` restored it: once per folder, until it gets
 *   children or is collapsed; a folder expanded again while still unloaded is
 *   asked for again.
 *
 * The visible nodes are flattened into rows of a fixed height, and only the
 * rows near the viewport are rendered, so a folder of 5,000 entries (FB-18)
 * opens as fast as a small one. The tree element keeps the focus and points at
 * the active row with `aria-activedescendant`; each row carries its own
 * `aria-level`, `aria-setsize` and `aria-posinset`.
 *
 * Keys: arrows, Home and End move; Right and Left expand, collapse and go to a
 * child or the parent (swapped in right-to-left text); Enter and Space open a
 * file or toggle a folder; typing finds a row by its label; Shift+F10 or the
 * ContextMenu key opens the row's `uiTreeItemMenu`. Tabbing in lands on the
 * open file.
 *
 * It fills its container and scrolls itself: in an island, set the island's
 * `scrollable` to false.
 */
@Component({
  selector: 'ui-tree',
  imports: [ CdkFixedSizeVirtualScroll, CdkVirtualForOf, CdkVirtualScrollViewport, IconComponent, NgTemplateOutlet ],
  templateUrl: './tree.component.html',
  styleUrl: './tree.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TreeComponent {
  readonly nodes = input.required<readonly TreeNode[]>();
  readonly label = input.required<string>();
  readonly selected = model<string | null>(null);
  readonly expanded = model<readonly string[]>([]);
  readonly loadChildren = output<string>();

  protected readonly id = `ui-tree-${nextId++}`;
  protected readonly nodeTemplate = contentChild(TreeNodeDirective);
  protected readonly itemSize = signal(FALLBACK_ROW_HEIGHT);

  /** The visible nodes in order: O(n) in visible rows. */
  protected readonly rows = computed(() => {
    const expanded = new Set(this.expanded());
    const rows: TreeRow[] = [];
    const visit = (nodes: readonly TreeNode[], level: number, parent: number) => {
      nodes.forEach((node, index) => {
        const expandable = node.expandable === true;
        const isExpanded = expandable && expanded.has(node.value);
        rows.push({
          node,
          level,
          setsize: nodes.length,
          posinset: index + 1,
          expanded: isExpanded,
          expandable,
          selectable: node.selectable ?? !expandable,
          parent
        });
        if (isExpanded && node.children) {
          visit(node.children, level + 1, rows.length - 1);
        }
      });
    };
    visit(this.nodes(), 1, -1);
    return rows;
  });

  private readonly rowIndex = computed(() => new Map(this.rows().map((row, index) => [ row.node.value, index ])));
  private readonly active = signal<ActiveRow | null>(null);

  /**
   * The active row's index. When the active row is gone (FB-41), it falls back
   * to the open file, else to the row now at the same place.
   */
  protected readonly activeIndex = computed(() => {
    const active = this.active();
    if (!active) {
      return -1;
    }
    const index = this.rowIndex().get(active.value) ?? this.selectedIndex();
    if (index !== -1) {
      return index;
    }
    return Math.min(active.index, this.rows().length - 1);
  });

  private readonly renderedRange = signal<ListRange>({ start: 0, end: 0 });

  /** Only a rendered row can be referenced. */
  protected readonly activeDescendant = computed(() => {
    const index = this.activeIndex();
    const { start, end } = this.renderedRange();
    return index >= start && index < end ? this.rowId(index) : null;
  });

  private readonly selectedIndex = computed(() => {
    const selected = this.selected();
    return selected === null ? -1 : this.rowIndex().get(selected) ?? -1;
  });

  private readonly viewport = viewChild.required(CdkVirtualScrollViewport);
  private readonly rowProbe = viewChild.required<ElementRef<HTMLElement>>('rowProbe');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly direction = inject(Directionality).valueSignal;
  private readonly focusMonitor = inject(FocusMonitor);

  /** Unloaded expanded folders that `loadChildren` has already asked for. */
  private asked = new Set<string>();
  private typeahead = '';
  private typeaheadTimer?: ReturnType<typeof setTimeout>;
  /** Set while our own code moves the focus to the tree element. */
  private focusingTree = false;

  constructor() {
    const destroyRef = inject(DestroyRef);

    afterNextRender(() => {
      const subscription = this.viewport().renderedRangeStream.subscribe(range => this.renderedRange.set(range));
      destroyRef.onDestroy(() => subscription.unsubscribe());

      // The focus origin tells keyboard focus from a mouse click or a tap; the
      // focus of a tap comes long after its pointerdown.
      const focusMonitor = this.focusMonitor;
      const tree = this.viewport().elementRef.nativeElement;
      const focus = focusMonitor.monitor(tree).subscribe(origin => this.onTreeFocus(origin));
      destroyRef.onDestroy(() => {
        focus.unsubscribe();
        focusMonitor.stopMonitoring(tree);
      });

      // The viewport is measured again, and so is the row height, when it is
      // shown again after `display: none` (a hidden pane or tab), resized or
      // rotated, and when the density changes (A-10.11): the probe is one row
      // high, so it resizes with `--ui-row-height`.
      this.measureRowHeight();
      if (typeof ResizeObserver !== 'function') {
        return;
      }
      const viewport = this.viewport();
      const observer = new ResizeObserver(() => {
        viewport.checkViewportSize();
        this.measureRowHeight();
      });
      observer.observe(tree);
      observer.observe(this.rowProbe().nativeElement);
      destroyRef.onDestroy(() => observer.disconnect());
    });

    effect(() => {
      const unloaded = this.rows()
        .filter(row => row.expanded && row.node.children === undefined)
        .map(row => row.node.value);
      untracked(() => this.askForChildren(unloaded));
    });

    destroyRef.onDestroy(() => clearTimeout(this.typeaheadTimer));
  }

  protected rowId(index: number): string {
    return `${this.id}-row-${index}`;
  }

  protected trackRow(_index: number, row: TreeRow): string {
    return row.node.value;
  }

  /**
   * A row's menu button is not a stop of its own: its focus, such as when its
   * menu closes, goes back to the tree, on its row.
   */
  protected onFocusIn(event: FocusEvent): void {
    const target = event.target as HTMLElement;
    if (target.matches('[uiTreeItemMenu]')) {
      const index = this.indexOfRowElement(target.closest('[role="treeitem"]'));
      if (index !== -1) {
        this.setActive(index);
      }
      this.focusTree();
    }
  }

  /**
   * Focus that reaches the tree element itself from outside: by keyboard or a
   * script, the open file, else the last active row, else the first. A click or
   * a tap neither moves nor scrolls: the click makes its own row active.
   */
  private onTreeFocus(origin: FocusOrigin): void {
    if (origin === null || origin === 'mouse' || origin === 'touch' || this.focusingTree) {
      return;
    }
    const last = this.active();
    const lastIndex = last ? this.rowIndex().get(last.value) ?? -1 : -1;
    const index = this.selectedIndex() !== -1 ? this.selectedIndex() : lastIndex !== -1 ? lastIndex : 0;
    if (index < this.rows().length) {
      this.setActive(index);
    }
  }

  /** Rows have no handlers of their own: the tree has the focus and the keys. */
  protected onClick(event: MouseEvent): void {
    const index = this.indexOfRowElement((event.target as Element).closest('[role="treeitem"]'));
    if (index === -1) {
      return;
    }
    this.focusTree();
    this.setActive(index);
    this.activate(index);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.target !== this.viewport().elementRef.nativeElement || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    if (this.handleKey(event)) {
      event.preventDefault();
    }
  }

  private handleKey(event: KeyboardEvent): boolean {
    const rows = this.rows();
    if (rows.length === 0) {
      return false;
    }
    const index = Math.max(this.activeIndex(), 0);
    const row = rows[index];
    const rtl = this.direction() === 'rtl';
    const key = event.key;

    if (event.shiftKey ? key === 'F10' : key === 'ContextMenu') {
      this.rowElement(index)?.querySelector<HTMLElement>('[uiTreeItemMenu]')?.click();
      return true;
    }
    if (key.length === 1 && (key !== ' ' || this.typeahead !== '')) {
      this.search(key, index);
      return true;
    }
    if (event.shiftKey) {
      return false;
    }

    switch (key) {
      case 'ArrowDown':
        this.setActive(Math.min(index + 1, rows.length - 1));
        return true;
      case 'ArrowUp':
        this.setActive(Math.max(index - 1, 0));
        return true;
      case 'Home':
        this.setActive(0);
        return true;
      case 'End':
        this.setActive(rows.length - 1);
        return true;
      case 'Enter':
      case ' ':
        this.setActive(index);
        this.activate(index);
        return true;
      case 'ArrowRight':
      case 'ArrowLeft':
        if ((key === 'ArrowRight') !== rtl) {
          this.expandOrEnter(index, row);
        } else {
          this.collapseOrLeave(index, row);
        }
        return true;
      default:
        return false;
    }
  }

  private expandOrEnter(index: number, row: TreeRow): void {
    if (row.expandable && !row.expanded) {
      this.setActive(index);
      this.setExpanded(row.node, true);
    } else if (row.expanded && this.rows()[index + 1]?.parent === index) {
      this.setActive(index + 1);
    } else {
      this.setActive(index);
    }
  }

  private collapseOrLeave(index: number, row: TreeRow): void {
    if (row.expanded) {
      this.setActive(index);
      this.setExpanded(row.node, false);
    } else {
      this.setActive(row.parent !== -1 ? row.parent : index);
    }
  }

  /** Opens a selectable row and toggles an expandable one. */
  private activate(index: number): void {
    const row = this.rows()[index];
    if (row.selectable) {
      this.selected.set(row.node.value);
    }
    if (row.expandable) {
      this.setExpanded(row.node, !row.expanded);
    }
  }

  private setExpanded(node: TreeNode, expanded: boolean): void {
    const values = this.expanded();
    if (values.includes(node.value) === expanded) {
      return;
    }
    this.expanded.set(expanded ? [ ...values, node.value ] : values.filter(value => value !== node.value));
  }

  /**
   * Asks once for each unloaded expanded folder, and forgets the folders that
   * got children or were collapsed, so that they are asked for again.
   */
  private askForChildren(unloaded: readonly string[]): void {
    const asked = new Set<string>();
    for (const value of unloaded) {
      if (!this.asked.has(value)) {
        this.loadChildren.emit(value);
      }
      asked.add(value);
    }
    this.asked = asked;
  }

  /** The next row whose label starts with what was typed (WAI-ARIA tree view). */
  private search(key: string, index: number): void {
    clearTimeout(this.typeaheadTimer);
    this.typeaheadTimer = setTimeout(() => (this.typeahead = ''), TYPEAHEAD_RESET_MS);
    this.typeahead += key.toLowerCase();

    const rows = this.rows();
    // A new search starts after the active row; a longer one may stay on it.
    const from = this.typeahead.length === 1 ? index + 1 : index;
    for (let offset = 0; offset < rows.length; offset++) {
      const candidate = (from + offset) % rows.length;
      if (rows[candidate].node.label.toLowerCase().startsWith(this.typeahead)) {
        this.setActive(candidate);
        return;
      }
    }
  }

  /** Scrolls the row into view first, so that the referenced element exists. */
  private setActive(index: number): void {
    const row = this.rows()[index];
    if (!row) {
      return;
    }
    this.scrollIntoView(index);
    this.active.set({ value: row.node.value, index });
  }

  private scrollIntoView(index: number): void {
    const viewport = this.viewport();
    const size = this.itemSize();
    const top = index * size;
    const offset = viewport.measureScrollOffset('top');
    const height = viewport.getViewportSize();
    if (top < offset) {
      viewport.scrollToOffset(top);
    } else if (top + size > offset + height) {
      viewport.scrollToOffset(top + size - height);
    }
  }

  private focusTree(): void {
    const tree = this.viewport().elementRef.nativeElement;
    if (this.host.ownerDocument.activeElement !== tree) {
      this.focusingTree = true;
      tree.focus({ preventScroll: true });
      this.focusingTree = false;
    }
  }

  private rowElement(index: number): HTMLElement | null {
    return this.host.ownerDocument.getElementById(this.rowId(index));
  }

  private indexOfRowElement(element: Element | null): number {
    const id = element?.id ?? '';
    const prefix = `${this.id}-row-`;
    return id.startsWith(prefix) ? Number(id.slice(prefix.length)) : -1;
  }

  /**
   * Rows are `var(--ui-row-height)` high; the CDK needs it in pixels, unrounded.
   * While hidden, the probe measures 0: the last known height is kept.
   */
  private measureRowHeight(): void {
    const height = this.rowProbe().nativeElement.getBoundingClientRect().height;
    if (height > 0 && height !== this.itemSize()) {
      this.itemSize.set(height);
    }
  }
}
