import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

/** Leaves the title strategy time to set the new page's title, which may wait for its texts. */
const ANNOUNCE_DELAY_MS = 100;

/**
 * Announces the title of each new page to screen readers (NV-18). The first
 * page of a page load is not announced: screen readers read the title then.
 */
@Component({
  selector: 'shell-route-announcer',
  templateUrl: './route-announcer.component.html',
  styleUrl: './route-announcer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RouteAnnouncerComponent {
  protected readonly message = signal('');

  constructor() {
    const router = inject(Router);
    const title = inject(Title);
    let initial = !router.navigated;
    let timer: ReturnType<typeof setTimeout> | undefined;
    router.events.pipe(filter(event => event instanceof NavigationEnd), takeUntilDestroyed()).subscribe(() => {
      if (initial) {
        initial = false;
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(() => this.message.set(title.getTitle()), ANNOUNCE_DELAY_MS);
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(timer));
  }
}
