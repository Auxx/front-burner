import { inject, Injectable } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';

/** The product name is not translated. */
const PRODUCT_NAME = 'Front Burner';

/** A route's `title` is a translation key; the document title is `<translated> · Front Burner` (NV-13). */
@Injectable({ providedIn: 'root' })
export class PageTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly transloco = inject(TranslocoService);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const key = this.buildTitle(snapshot);
    this.title.setTitle(key === undefined ? PRODUCT_NAME : `${this.transloco.translate(key)} · ${PRODUCT_NAME}`);
  }
}
