import { Directive } from '@angular/core';

/**
 * Marks the page's `h1` inside `ui-page`, which shows it in the title bar after
 * the breadcrumbs. It can take the focus, so that route focus lands on it.
 */
@Directive({
  selector: '[uiPageTitle]',
  host: {
    tabindex: '-1'
  }
})
export class PageTitleDirective {
}
