import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, TitleStrategy } from '@angular/router';
import { provideTransloco, TranslocoTestingModule } from '@jsverse/transloco';

import { TranslocoHttpLoader } from '../i18n/transloco-http.loader';

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
          { path: 'plain', component: BlankComponent },
          { path: 'own', data: { ownTitle: true }, component: BlankComponent }
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

  it('leaves the title to a page whose route has `ownTitle`', async () => {
    await router.navigateByUrl('/login');
    document.title = 'handbook · Front Burner';
    await router.navigateByUrl('/own');
    expect(document.title).toBe('handbook · Front Burner');
  });
});

describe('PageTitleStrategy with the on-demand loader', () => {
  it('waits for the language file instead of showing the raw key', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTransloco({
          config: { availableLangs: [ 'en' ], defaultLang: 'en', prodMode: true },
          loader: TranslocoHttpLoader
        }),
        provideRouter([ { path: 'login', title: 'feature.title', component: BlankComponent } ]),
        { provide: TitleStrategy, useClass: PageTitleStrategy }
      ]
    });
    document.title = 'before';
    const http = TestBed.inject(HttpTestingController);
    await TestBed.inject(Router).navigateByUrl('/login');

    expect(document.title).not.toContain('feature.title');

    http.expectOne('i18n/en.json').flush({ 'feature.title': 'Log in' });
    await TestBed.inject(ApplicationRef).whenStable();

    expect(document.title).toBe('Log in · Front Burner');
  });

  it('does not let a slower earlier title overwrite a later one', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTransloco({
          config: { availableLangs: [ 'en' ], defaultLang: 'en', prodMode: true },
          loader: TranslocoHttpLoader
        }),
        provideRouter([
          { path: 'login', title: 'feature.title', component: BlankComponent },
          { path: 'plain', component: BlankComponent }
        ]),
        { provide: TitleStrategy, useClass: PageTitleStrategy }
      ]
    });
    const http = TestBed.inject(HttpTestingController);
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/login');
    await router.navigateByUrl('/plain');
    http.expectOne('i18n/en.json').flush({ 'feature.title': 'Log in' });
    await TestBed.inject(ApplicationRef).whenStable();

    expect(document.title).toBe('Front Burner');
  });
});
