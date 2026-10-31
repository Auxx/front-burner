import { Directive, inject, TemplateRef } from '@angular/core';

/**
 * Marks one ancestor in the title bar of `ui-page`, used as `*uiBreadcrumb`.
 * The page renders its template inside a list item of the breadcrumb `nav`.
 */
@Directive({
  selector: 'ng-template[uiBreadcrumb]'
})
export class BreadcrumbDirective {
  readonly template = inject(TemplateRef);
}
