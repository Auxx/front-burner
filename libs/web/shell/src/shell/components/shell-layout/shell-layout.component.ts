import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  inject,
  Injector
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { AppShellComponent } from '@front-burner/ui';
import { AuthSessionService, CurrentUserService } from '@front-burner/web-core';
import { TranslocoDirective } from '@jsverse/transloco';
import { filter } from 'rxjs';

import { AppHeaderComponent } from '../app-header/app-header.component';
import { RouteAnnouncerComponent } from '../route-announcer/route-announcer.component';

/**
 * The layout of the pages inside the web client (NV-5, NV-17, NV-18): the skip
 * link, the app header while the user is logged in, and the page in `main`.
 * After moving to another page the focus goes to its `h1`, which the page gives
 * `tabindex="-1"`.
 */
@Component({
  selector: 'shell-layout',
  imports: [ TranslocoDirective, RouterOutlet, AppShellComponent, AppHeaderComponent, RouteAnnouncerComponent ],
  templateUrl: './shell-layout.component.html',
  styleUrl: './shell-layout.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ShellLayoutComponent {
  private readonly currentUser = inject(CurrentUserService);

  protected readonly user = this.currentUser.user;

  constructor() {
    const session = inject(AuthSessionService);
    effect(() => {
      if (session.loggedIn()) {
        // Without the user there is no header; a request that failed for its
        // token has already sent the user to the login page.
        this.currentUser.load().catch(() => undefined);
      }
    });

    const router = inject(Router);
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const injector = inject(Injector);
    // The first page of a page load leaves the focus at the start, on the way to the skip link.
    let initial = !router.navigated;
    router.events.pipe(filter(event => event instanceof NavigationEnd), takeUntilDestroyed()).subscribe(() => {
      if (initial) {
        initial = false;
        return;
      }
      afterNextRender(() => host.querySelector<HTMLElement>('main h1')?.focus(), { injector });
    });
  }
}
