import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, contentChildren, input } from '@angular/core';

import { BreadcrumbDirective } from '../../../navigation/directives/breadcrumb/breadcrumb.directive';
import { IslandComponent } from '../island/island.component';

/**
 * A page made of one island that fills its container (A-10.5), such as the
 * dashboard. The island starts with a one-line title bar: the ancestors, each
 * marked with `*uiBreadcrumb`, in a breadcrumb `nav`, then the page's
 * `h1[uiPageTitle]` outside it (NV-14). A page without ancestors shows only its
 * `h1`. The rest of the content follows below, stacked, and scrolls inside the
 * island.
 *
 * With `column`, the title bar and the content are in a column of at most that
 * width, centred in the island.
 */
@Component({
  selector: 'ui-page',
  imports: [ NgTemplateOutlet, IslandComponent ],
  templateUrl: './page.component.html',
  styleUrl: './page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PageComponent {
  /** The accessible name of the breadcrumb `nav`, such as "Breadcrumb"; needed when there are ancestors. */
  readonly breadcrumbsLabel = input<string>();
  /** The maximum inline size of a centred content column, such as `'40rem'`; none fills the island. */
  readonly column = input<string | null>(null);

  protected readonly ancestors = contentChildren(BreadcrumbDirective);
}
