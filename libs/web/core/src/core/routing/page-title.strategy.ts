import { inject, Injectable } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { ActivatedRouteSnapshot, RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import type { Subscription } from 'rxjs';
import { take } from 'rxjs';

/** The product name is not translated. */
const PRODUCT_NAME = 'Front Burner';

/**
 * A route's `title` is a translation key; the document title is `<translated> ·
 * Front Burner` (NV-13). A page whose title depends on what it loads, such as
 * the repository screen, sets it itself: its route has `data: { ownTitle: true }`.
 */
@Injectable({ providedIn: 'root' })
export class PageTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly transloco = inject(TranslocoService);

  private pending?: Subscription;

  override updateTitle(snapshot: RouterStateSnapshot): void {
    // A newer navigation cancels a title that is still waiting for its language file.
    this.pending?.unsubscribe();
    if (this.deepest(snapshot).data['ownTitle'] === true) {
      return;
    }
    const key = this.buildTitle(snapshot);
    if (key === undefined) {
      this.title.setTitle(PRODUCT_NAME);
      return;
    }
    this.pending = this.transloco.selectTranslate(key).pipe(take(1)).subscribe(translated => {
      this.title.setTitle(`${translated} · ${PRODUCT_NAME}`);
    });
  }

  private deepest(snapshot: RouterStateSnapshot): ActivatedRouteSnapshot {
    let route = snapshot.root;
    while (route.firstChild) {
      route = route.firstChild;
    }
    return route;
  }
}
