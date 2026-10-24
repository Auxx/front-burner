import { Directive } from '@angular/core';

/**
 * The actions button inside a `ui-tree` row, on the same button as
 * `uiMenuTrigger`. It is not a tab stop: Shift+F10 or the ContextMenu key on
 * the row opens its menu, and the focus returns to the row afterwards. A click
 * on it does not select or toggle the row.
 */
@Directive({
  selector: 'button[uiTreeItemMenu]',
  host: {
    tabindex: '-1',
    '(click)': '$event.stopPropagation()'
  }
})
export class TreeItemMenuDirective {
}
