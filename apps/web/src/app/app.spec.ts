import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideCore } from '@front-burner/web-core';

import en from '../../public/i18n/en.json';
import { appRoutes } from './app.routes';

describe('appRoutes', () => {
  async function open(url: string) {
    TestBed.configureTestingModule({
      providers: [ provideCore(), provideHttpClientTesting(), provideRouter(appRoutes) ]
    });
    const harness = await RouterTestingHarness.create();
    const navigation = harness.navigateByUrl(url);
    const http = TestBed.inject(HttpTestingController);
    // The language file is requested once the lazy feature has loaded.
    await vi.waitFor(() => expect(http.match('i18n/en.json').map(request => request.flush(en))).not.toHaveLength(0));
    await navigation;
    await harness.fixture.whenStable();
    harness.detectChanges();
    return harness;
  }

  it.each([ '/', '/nowhere/at/all' ])('sends %s to the login page', async url => {
    const harness = await open(url);

    expect(TestBed.inject(Router).url).toBe('/login');
    expect(harness.routeNativeElement?.textContent).toContain('Signing in isn\'t available yet.');
    expect(document.title).toBe('Log in · Front Burner');
  });
});
