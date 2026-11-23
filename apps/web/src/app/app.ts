import { afterNextRender, ChangeDetectionStrategy, Component, inject, Injector } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { markPerformance } from '@front-burner/shared-util';
import { ToastOutletComponent } from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';
import { filter, take } from 'rxjs';

/**
 * The root of the web client. Once the first route's page has rendered, it
 * sets the performance mark `fb:app-ready` (A-8.17, NF-2.7).
 */
@Component({
  selector: 'app-root',
  imports: [ RouterOutlet, ToastOutletComponent, TranslocoDirective ],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class App {
  constructor() {
    const injector = inject(Injector);
    inject(Router).events.pipe(
      filter(event => event instanceof NavigationEnd),
      take(1),
      takeUntilDestroyed()
    ).subscribe(() => afterNextRender(() => markPerformance('fb:app-ready'), { injector }));
  }
}
