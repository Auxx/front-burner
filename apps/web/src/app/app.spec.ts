import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { OnboardingStatus } from '@front-burner/shared-contracts';
import { provideCore } from '@front-burner/web-core';

import en from '../../public/i18n/en.json';
import { appRoutes } from './app.routes';

const required: OnboardingStatus = { state: 'required', oidcFromEnvironment: false, setupTokenConfigured: true };

describe('appRoutes', () => {
  /** Opens `url`; the onboarding state endpoint answers with `state`, or 404 (completed) without one. */
  async function open(url: string, state?: OnboardingStatus) {
    TestBed.configureTestingModule({
      providers: [ provideCore(), provideHttpClientTesting(), provideRouter(appRoutes) ]
    });
    const harness = await RouterTestingHarness.create();
    const navigation = harness.navigateByUrl(url);
    const http = TestBed.inject(HttpTestingController);
    await vi.waitFor(() =>
      expect(
        http.match('/api/v1/onboarding').map(request =>
          state ? request.flush(state) : request.flush(null, { status: 404, statusText: 'Not Found' })
        )
      ).not.toHaveLength(0)
    );
    // The language file is requested once the lazy feature has loaded.
    await vi.waitFor(() => expect(http.match('i18n/en.json').map(request => request.flush(en))).not.toHaveLength(0));
    await navigation;
    await harness.fixture.whenStable();
    harness.detectChanges();
    return harness;
  }

  it.each([ '/', '/nowhere/at/all' ])('sends %s to the login page once onboarding is completed', async url => {
    const harness = await open(url);

    expect(TestBed.inject(Router).url).toBe('/login');
    expect(harness.routeNativeElement?.textContent).toContain('Signing in isn\'t available yet.');
    expect(document.title).toBe('Log in · Front Burner');
  });

  it.each([ '/', '/login', '/nowhere/at/all' ])('sends %s to the onboarding page while it is required', async url => {
    const harness = await open(url, required);

    expect(TestBed.inject(Router).url).toBe('/onboarding');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toContain('Set up Front Burner');
    expect(document.title).toBe('Set up Front Burner · Front Burner');
  });
});
