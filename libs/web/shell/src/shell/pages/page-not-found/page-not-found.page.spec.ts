import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { PageNotFoundPage } from './page-not-found.page';

const KEY = 'web-shell.PageNotFoundPage';

describe('PageNotFoundPage', () => {
  let page: HTMLElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [ translocoTesting() ],
      providers: [ provideRouter([ { path: '**', component: PageNotFoundPage } ]) ]
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/no/such/page');
    await settle(harness.fixture);
    page = harness.routeNativeElement as HTMLElement;
  });

  it('says the page does not exist in its one heading', () => {
    expect(page.querySelectorAll('h1')).toHaveLength(1);
    expect(page.querySelector('h1')?.textContent?.trim()).toBe(`${KEY}.heading`);
    expect(page.querySelector('h1')?.getAttribute('tabindex')).toBe('-1');
  });

  it('links to the dashboard', () => {
    const link = page.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/');
    expect(link?.textContent?.trim()).toBe(`${KEY}.dashboard`);
  });
});
