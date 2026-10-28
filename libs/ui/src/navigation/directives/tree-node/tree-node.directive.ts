import { Directive, inject, TemplateRef } from '@angular/core';

import type { TreeNode } from '../../models/tree-node.model';

/** What a `uiTreeNode` template receives for each row. */
export interface TreeNodeContext {
  readonly $implicit: TreeNode;
  readonly level: number;
  readonly expanded: boolean;
  /**
   * Whether the row is the active row and the keyboard moved there, while the
   * tree has the focus: the row can then show what hover would show, since
   * the focus stays on the tree (FB-20a).
   */
  readonly active: boolean;
}

/**
 * The content of each row of a `ui-tree`, after its chevron:
 * `<ng-template uiTreeNode let-node let-level="level" let-active="active">`. Without it, a row
 * shows the node's label.
 */
@Directive({
  selector: 'ng-template[uiTreeNode]'
})
export class TreeNodeDirective {
  readonly template = inject<TemplateRef<TreeNodeContext>>(TemplateRef);

  /** Types `let-node` and the other variables of the template. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the signature is Angular's contract
  static ngTemplateContextGuard(_directive: TreeNodeDirective, context: unknown): context is TreeNodeContext {
    return true;
  }
}
