import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { CurrentUser } from '@front-burner/shared-contracts';
import {
  MenuComponent,
  MenuGroupDirective,
  MenuItemComponent,
  MenuSeparatorComponent,
  MenuTriggerDirective
} from '@front-burner/ui';
import { APP_VERSION, AuthSessionService } from '@front-burner/web-core';
import { TranslocoDirective } from '@jsverse/transloco';

import { initials } from '../../utils/initials/initials';

type Item = 'preferences' | 'logout' | 'version';

/**
 * The user menu of the app header (NV-7, NV-8): who is logged in,
 * **Preferences**, **Log out** and the web client's version.
 */
@Component({
  selector: 'shell-user-menu',
  imports: [
    TranslocoDirective,
    RouterLink,
    MenuComponent,
    MenuGroupDirective,
    MenuItemComponent,
    MenuSeparatorComponent,
    MenuTriggerDirective
  ],
  templateUrl: './user-menu.component.html',
  styleUrl: './user-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UserMenuComponent {
  readonly user = input.required<CurrentUser>();

  private readonly session = inject(AuthSessionService);

  /** The code that runs, which is what a bug report needs (NV-7). */
  protected readonly version = inject(APP_VERSION);

  protected readonly initials = computed(() => initials(this.user().displayName));

  protected selected(item: Item): void {
    if (item === 'logout') {
      void this.session.logout();
    }
  }
}
