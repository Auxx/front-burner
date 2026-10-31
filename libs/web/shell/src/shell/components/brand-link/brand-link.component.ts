import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { IconComponent } from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

/**
 * **Dashboard**, the first link of the app header (NV-5, NV-9), in bold on the
 * dashboard. Compact, it shows only a home icon and is named "Dashboard".
 * Otherwise the home icon replaces the name on narrow screens, where the name
 * stays the link's name for screen readers.
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
