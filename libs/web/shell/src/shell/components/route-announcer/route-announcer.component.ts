import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';
import { ownsTitle, PageTitleService } from '@front-burner/web-core';

/** Leaves the title strategy time to set the new page's title, which may wait for its texts. */
const ANNOUNCE_DELAY_MS = 100;

/**
 * Announces the title of each new page to screen readers (NV-18). The first
 * page of a page load is not announced: screen readers read the title then. A
 * page that sets its own title, such as the repository screen, is announced
 * when it publishes it, however long it takes to load.
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
    /** Waiting for the title of the current page, which sets its own. */
    let waiting = false;
    /** A title the page published before its navigation ended. */
    let early: string | undefined;

    router.events.pipe(takeUntilDestroyed()).subscribe(event => {
      if (event instanceof NavigationStart) {
        clearTimeout(timer);
        waiting = false;
        early = undefined;
        return;
      }
      if (!(event instanceof NavigationEnd)) {
        return;
      }
      if (initial) {
        initial = false;
        return;
      }
      if (ownsTitle(router.routerState.snapshot)) {
        if (early === undefined) {
          waiting = true;
        } else {
          this.message.set(early);
        }
        return;
      }
      timer = setTimeout(() => this.message.set(title.getTitle()), ANNOUNCE_DELAY_MS);
    });

    inject(PageTitleService).changes.pipe(takeUntilDestroyed()).subscribe(published => {
      if (waiting) {
        this.message.set(published);
      } else if (router.currentNavigation()) {
        early = published;
      }
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(timer));
  }
}
