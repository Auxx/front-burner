import { Directive, inject, TemplateRef } from '@angular/core';

/**
 * Marks one item of the breadcrumbs, used as `*uiBreadcrumb`. The breadcrumbs
 * render its template inside a list item.
 */
@Directive({
  selector: 'ng-template[uiBreadcrumb]'
})
export class BreadcrumbDirective {
  readonly template = inject(TemplateRef);
}
