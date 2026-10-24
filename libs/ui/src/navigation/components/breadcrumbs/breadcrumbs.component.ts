import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, contentChildren, input } from '@angular/core';

import { BreadcrumbDirective } from '../../directives/breadcrumb/breadcrumb.directive';

/**
 * The path to the current page (NV-14). Each item is marked with
 * `*uiBreadcrumb`: the last one is the current page and is given as text, the
 * others as links. The separators are drawn by CSS, so they are not announced.
 */
@Component({
  selector: 'ui-breadcrumbs',
  imports: [ NgTemplateOutlet ],
  templateUrl: './breadcrumbs.component.html',
  styleUrl: './breadcrumbs.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'navigation',
    '[attr.aria-label]': 'label()'
  }
})
export class BreadcrumbsComponent {
  /** The accessible name of the landmark, such as "Breadcrumb". */
  readonly label = input.required<string>();

  protected readonly items = contentChildren(BreadcrumbDirective);
}
