import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import type { CurrentUser } from '@front-burner/shared-contracts';
import {
  ButtonComponent,
  IconComponent,
  MenuComponent,
  MenuItemComponent,
  MenuTriggerDirective
} from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

import { BrandLinkComponent } from '../brand-link/brand-link.component';
import { UserMenuComponent } from '../user-menu/user-menu.component';

/**
 * The app header (NV-5, NV-6): **Dashboard** and **Repositories**, the current
 * page's link in bold, then the user menu. On narrow screens a home icon stands
 * for the first link, and the links are also in a **Menu**.
 */
@Component({
  selector: 'shell-app-header',
  imports: [
    TranslocoDirective,
    RouterLink,
    RouterLinkActive,
    ButtonComponent,
    IconComponent,
    MenuComponent,
    MenuItemComponent,
    MenuTriggerDirective,
    BrandLinkComponent,
    UserMenuComponent
  ],
  templateUrl: './app-header.component.html',
  styleUrl: './app-header.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppHeaderComponent {
  readonly user = input.required<CurrentUser>();
}
