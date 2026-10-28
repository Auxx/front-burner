import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { IconComponent } from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

/**
 * The product's icon and name, a link to the dashboard (NV-5, NV-9). Compact,
 * it shows only the icon and is named "Dashboard". Otherwise the name is hidden
 * on narrow screens but stays the link's name for screen readers.
 */
@Component({
  selector: 'shell-brand-link',
  imports: [ TranslocoDirective, RouterLink, RouterLinkActive, IconComponent ],
  templateUrl: './brand-link.component.html',
  styleUrl: './brand-link.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class BrandLinkComponent {
  readonly compact = input(false);
}
