import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { CurrentUser, OnboardingStatus } from '@front-burner/shared-contracts';
import { provideCore } from '@front-burner/web-core';

import en from '../../public/i18n/en.json';
import { appRoutes } from './app.routes';

const required: OnboardingStatus = { state: 'required', oidcFromEnvironment: false, setupTokenConfigured: true };
const ada: CurrentUser = {
  id: 1,
  email: 'ada@example.com',
  displayName: 'Ada Lovelace',
  role: 'administrator',
  allowedGitLevels: [ 'advanced' ]
};
const session = {
  authToken: 'token',
  authTokenExpiresAt: '2026-10-26T10:15:00.000Z',
  refreshTokenExpiresAt: '2026-11-25T10:00:00.000Z'
};

describe('appRoutes', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  /**
   * Opens `url` and answers the backend until the page has its heading: the
   * onboarding state with `state`, or 404 (completed) without one; the current
   * user; the language file.
   */
  async function open(url: string, options: { state?: OnboardingStatus; loggedIn?: boolean; } = {}) {
    if (options.loggedIn) {
      localStorage.setItem('front-burner.auth', JSON.stringify(session));
    }
    TestBed.configureTestingModule({
      providers: [ provideCore(), provideHttpClientTesting(), provideRouter(appRoutes) ]
    });
    const harness = await RouterTestingHarness.create();
    const navigation = harness.navigateByUrl(url);
    const http = TestBed.inject(HttpTestingController);
    const heading = () => harness.fixture.nativeElement.querySelector('h1')?.textContent?.trim();
    // The first test loads the lazy routes cold, which can take more than the
    // default second on a busy CI runner.
    await vi.waitFor(() => {
      for (const request of http.match('/api/v1/onboarding')) {
        if (options.state) {
          request.flush(options.state);
        } else {
          request.flush(null, { status: 404, statusText: 'Not Found' });
        }
      }
      http.match('/api/v1/me').forEach(request => request.flush(ada));
      http.match('i18n/en.json').forEach(request => request.flush(en));
      harness.detectChanges();
      expect(heading()).toBeTruthy();
    }, { timeout: 4000 });
    await navigation;
    await harness.fixture.whenStable();
    harness.detectChanges();
    return { harness, heading, header: () => harness.fixture.nativeElement.querySelector('shell-app-header') };
  }

  it('sends / to the login page when logged out', async () => {
    const { heading, header } = await open('/');

    expect(TestBed.inject(Router).url).toBe('/login?returnUrl=%2F');
    expect(heading()).toBe('Log in');
    expect(header()).toBeNull();
    expect(document.title).toBe('Log in · Front Burner');
  });

  it('shows the dashboard at / when logged in', async () => {
    const { heading, header } = await open('/', { loggedIn: true });

    expect(TestBed.inject(Router).url).toBe('/');
    expect(heading()).toBe('Dashboard');
    await vi.waitFor(() => expect(header()).not.toBeNull());
    expect(document.title).toBe('Dashboard · Front Burner');
  });

  it('sends a logged-in user from the login page home', async () => {
    const { heading } = await open('/login', { loggedIn: true });

    expect(TestBed.inject(Router).url).toBe('/');
    expect(heading()).toBe('Dashboard');
  });

  it('shows Page not found for an unknown route', async () => {
    const { heading, header } = await open('/nowhere/at/all');

    expect(TestBed.inject(Router).url).toBe('/nowhere/at/all');
    expect(heading()).toBe('This page doesn\'t exist.');
    expect(header()).toBeNull();
    expect(document.title).toBe('Page not found · Front Burner');
  });

  it('shows Page not found at /repositories, with the header, when logged in', async () => {
    const { heading, header } = await open('/repositories', { loggedIn: true });

    expect(heading()).toBe('This page doesn\'t exist.');
    await vi.waitFor(() => expect(header()).not.toBeNull());
  });

  it('opens the Add repository page at /repositories/new when logged in', async () => {
    const { heading, header } = await open('/repositories/new', { loggedIn: true });

    expect(TestBed.inject(Router).url).toBe('/repositories/new');
    expect(heading()).toBe('Add repository');
    await vi.waitFor(() => expect(header()).not.toBeNull());
    expect(document.title).toBe('Add repository · Front Burner');
  });

  it('sends /repositories/new to the login page when logged out', async () => {
    const { heading } = await open('/repositories/new');

    expect(TestBed.inject(Router).url).toBe('/login?returnUrl=%2Frepositories%2Fnew');
    expect(heading()).toBe('Log in');
  });

  describe('the repository screen', () => {
    const screen = (harness: RouterTestingHarness) =>
      harness.fixture.nativeElement.querySelector('rs-repository-screen');

    it.each([ '/repositories/12', '/repositories/12/files/a/b.md' ])(
      'routes /repositories/12 and /repositories/12/files/a/b.md to the repository screen: %s',
      async url => {
        localStorage.setItem('front-burner.auth', JSON.stringify(session));
        TestBed.configureTestingModule({
          providers: [ provideCore(), provideHttpClientTesting(), provideRouter(appRoutes) ]
        });
        const harness = await RouterTestingHarness.create();
        const navigation = harness.navigateByUrl(url);
        const http = TestBed.inject(HttpTestingController);
        await vi.waitFor(() => {
          http.match('/api/v1/onboarding').forEach(request =>
            request.flush(null, { status: 404, statusText: 'Not Found' })
          );
          http.match('/api/v1/me').forEach(request => request.flush(ada));
          http.match('i18n/en.json').forEach(request => request.flush(en));
          harness.detectChanges();
          expect(screen(harness)).not.toBeNull();
        }, { timeout: 4000 });
        await navigation;

        expect(TestBed.inject(Router).url).toBe(url);
        // The screen has its own bar instead of the app header (NV-9).
        expect(harness.fixture.nativeElement.querySelector('shell-layout')).toBeNull();
      }
    );

    it('leaves /repositories/new to the Add repository page', async () => {
      const { harness, heading } = await open('/repositories/new', { loggedIn: true });

      expect(heading()).toBe('Add repository');
      expect(screen(harness)).toBeNull();
    });

    it('leaves /repositories/12/settings to Page not found', async () => {
      const { harness, heading } = await open('/repositories/12/settings', { loggedIn: true });

      expect(TestBed.inject(Router).url).toBe('/repositories/12/settings');
      expect(heading()).toBe('This page doesn\'t exist.');
      expect(screen(harness)).toBeNull();
    });

    it.each([ '/repositories/0', '/repositories/007', '/repositories/9007199254740993' ])(
      'shows Page not found for an ID that no repository can have: %s',
      async url => {
        const { harness, heading } = await open(url, { loggedIn: true });

        expect(heading()).toBe('This page doesn\'t exist.');
        expect(screen(harness)).toBeNull();
      }
    );

    it('sends a visitor who is not logged in to the login page', async () => {
      const { harness, heading } = await open('/repositories/12/files/docs/guide.md');

      expect(TestBed.inject(Router).url).toBe('/login?returnUrl=%2Frepositories%2F12%2Ffiles%2Fdocs%2Fguide.md');
      expect(heading()).toBe('Log in');
      expect(screen(harness)).toBeNull();
    });
  });

  it.each([ '/', '/login', '/nowhere/at/all' ])('sends %s to the onboarding page while it is required', async url => {
    const { heading } = await open(url, { state: required });

    expect(TestBed.inject(Router).url).toBe('/onboarding');
    expect(heading()).toContain('Set up Front Burner');
    expect(document.title).toBe('Set up Front Burner · Front Burner');
  });
});
