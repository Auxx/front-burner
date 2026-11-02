import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { CurrentUser } from '@front-burner/shared-contracts';
import { MenuComponent, MenuGroupDirective, MenuItemComponent, MenuTriggerDirective } from '@front-burner/ui';
import { AuthSessionService } from '@front-burner/web-core';
import { TranslocoDirective } from '@jsverse/transloco';

import { initials } from '../../utils/initials/initials';

type Item = 'preferences' | 'logout';

/** The user menu of the app header (NV-7, NV-8): who is logged in, **Preferences** and **Log out**. */
@Component({
  selector: 'shell-user-menu',
  imports: [
    TranslocoDirective,
    RouterLink,
    MenuComponent,
    MenuGroupDirective,
    MenuItemComponent,
    MenuTriggerDirective
  ],
  templateUrl: './user-menu.component.html',
  styleUrl: './user-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UserMenuComponent {
  readonly user = input.required<CurrentUser>();

  private readonly session = inject(AuthSessionService);

  protected readonly initials = computed(() => initials(this.user().displayName));

  protected selected(item: Item): void {
    if (item === 'logout') {
      void this.session.logout();
    }
  }
}
