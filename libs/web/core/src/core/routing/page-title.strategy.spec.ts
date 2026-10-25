import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, TitleStrategy } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';

import { PageTitleStrategy } from './page-title.strategy';

@Component({ template: '' })
class BlankComponent {}

describe('PageTitleStrategy', () => {
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: { en: { 'feature.title': 'Log in' } },
          preloadLangs: true,
          translocoConfig: { availableLangs: [ 'en' ], defaultLang: 'en' }
        })
      ],
      providers: [
        provideRouter([
          { path: 'login', title: 'feature.title', component: BlankComponent },
          { path: 'plain', component: BlankComponent }
        ]),
        { provide: TitleStrategy, useClass: PageTitleStrategy }
      ]
    });
    router = TestBed.inject(Router);
  });

  it('translates the route title and appends the product name', async () => {
    await router.navigateByUrl('/login');
    expect(document.title).toBe('Log in · Front Burner');
  });

  it('uses the product name alone for a route without a title', async () => {
    await router.navigateByUrl('/plain');
    expect(document.title).toBe('Front Burner');
  });
});
