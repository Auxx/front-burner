import { inject, Injectable } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { Subject } from 'rxjs';

/** The product name is not translated. */
const PRODUCT_NAME = 'Front Burner';

/**
 * The document title, `<page> · Front Burner` (NV-13). Most pages get it from
 * their route's `title`. A page whose title depends on what it loads, such as
 * the repository screen, has `data: { ownTitle: true }` on its route and sets
 * it here; `changes` tells the route announcer when it is known (NV-18).
 */
@Injectable({ providedIn: 'root' })
export class PageTitleService {
  private readonly title = inject(Title);
  private readonly published = new Subject<string>();

  /** Each title a page has set itself with `publish`. */
  readonly changes = this.published.asObservable();

  format(page?: string): string {
    return page === undefined ? PRODUCT_NAME : `${page} · ${PRODUCT_NAME}`;
  }

  /** Sets the page's own title, now that it knows it. */
  publish(page?: string): void {
    const title = this.format(page);
    this.title.setTitle(title);
    this.published.next(title);
  }

  /** Sets the product name alone while the page does not know its title yet, such as while it loads. */
  setPending(): void {
    this.title.setTitle(PRODUCT_NAME);
  }
}

/** Whether the page of this navigation sets its own title. */
export function ownsTitle(snapshot: RouterStateSnapshot): boolean {
  let route: ActivatedRouteSnapshot = snapshot.root;
  while (route.firstChild) {
    route = route.firstChild;
  }
  return route.data['ownTitle'] === true;
}
