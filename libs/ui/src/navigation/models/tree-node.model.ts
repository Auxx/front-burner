/** One node of a `ui-tree`, such as a folder or a file of a working copy. */
export interface TreeNode {
  /** Unique in the tree, such as a path. */
  readonly value: string;
  /** The visible text and the typeahead text. */
  readonly label: string;
  /**
   * The row's accessible name; defaults to `label`. The feature composes the
   * kind and flags into it (FB-46), such as "guide.md, Markdown file, ignored".
   * It must start with the visible label (WCAG 2.5.3, label in name).
   */
  readonly accessibleName?: string;
  /** Folders: can be expanded. */
  readonly expandable?: boolean;
  /** Children of an expandable node; undefined until they are loaded. */
  readonly children?: readonly TreeNode[];
  /** Defaults to !expandable. */
  readonly selectable?: boolean;
}
