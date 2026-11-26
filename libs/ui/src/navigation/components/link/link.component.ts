import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * A link that stands on its own, outside running text, such as a repository's
 * name in a list or **All repositories**. It looks like any link, but is a
 * whole target of 44 px on touch screens (NF-13.5), with the room around it to
 * match; in compact density it is as it would be without. A link inside a
 * sentence needs none, as WCAG 2.5.8 allows.
 */
@Component({
  selector: 'a[uiLink]',
  imports: [],
  templateUrl: './link.component.html',
  styleUrl: './link.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LinkComponent {
}
