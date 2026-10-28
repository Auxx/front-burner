import { inject, Injectable } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import type { Subscription } from 'rxjs';
import { take } from 'rxjs';

import { ownsTitle, PageTitleService } from '../services/page-title/page-title.service';

/**
 * A route's `title` is a translation key; the document title is `<translated> ·
 * Front Burner` (NV-13). A route with `data: { ownTitle: true }` leaves the
 * title to its page, which sets it with `PageTitleService`.
 */
@Injectable({ providedIn: 'root' })
export class PageTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly pageTitle = inject(PageTitleService);
  private readonly transloco = inject(TranslocoService);

  private pending?: Subscription;

  override updateTitle(snapshot: RouterStateSnapshot): void {
    // A newer navigation cancels a title that is still waiting for its language file.
    this.pending?.unsubscribe();
    if (ownsTitle(snapshot)) {
      return;
    }
    const key = this.buildTitle(snapshot);
    if (key === undefined) {
      this.title.setTitle(this.pageTitle.format());
      return;
    }
    this.pending = this.transloco.selectTranslate(key).pipe(take(1)).subscribe(translated => {
      this.title.setTitle(this.pageTitle.format(translated));
    });
  }
}
