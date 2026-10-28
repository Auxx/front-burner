import { HttpErrorResponse } from '@angular/common/http';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { LoginMethods } from '@front-burner/shared-contracts';
import { AuthApi } from '@front-burner/web-api-client';
import { AuthSessionService } from '@front-burner/web-core';
import { of } from 'rxjs';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { BROWSER_LOCATION } from '../../utils/browser-location';
import { LoginPage } from './login.page';

const KEY = 'web-feature-auth.LoginPage';

@Component({ template: '' })
class BlankComponent {}

const apiError = (code: string, status: number) =>
  new HttpErrorResponse({ status, error: { code, params: {}, requestId: 'abcdef123456', message: `${code} message` } });

describe('LoginPage', () => {
  let login: ReturnType<typeof vi.fn>;
  let methods: LoginMethods;
  let harness: RouterTestingHarness;

  const page = () => harness.routeNativeElement as HTMLElement;
  const email = () => page().querySelector('input[type="email"]') as HTMLInputElement;
  const password = () => page().querySelector('input[autocomplete="current-password"]') as HTMLInputElement;
  const button = () => page().querySelector('button[type="submit"]') as HTMLButtonElement;

  async function open(
    url = '/login',
    options: { state?: object; location?: Pick<Location, 'protocol' | 'hostname'>; } = {}
  ): Promise<void> {
    TestBed.configureTestingModule({
      imports: [ translocoTesting() ],
      providers: [
        provideRouter([ { path: 'login', component: LoginPage }, { path: '**', component: BlankComponent } ]),
        { provide: AuthSessionService, useValue: { login } },
        { provide: AuthApi, useValue: { methods: () => of(methods) } },
        { provide: BROWSER_LOCATION, useValue: options.location ?? { protocol: 'https:', hostname: 'fb.example' } }
      ]
    });
    harness = await RouterTestingHarness.create();
    await TestBed.inject(Router).navigateByUrl(url, { state: options.state });
    await settle(harness.fixture);
  }

  async function type(input: HTMLInputElement, value: string): Promise<void> {
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle(harness.fixture);
  }

  async function fillIn(): Promise<void> {
    await type(email(), 'ada@example.com');
    await type(password(), 'correct horse');
  }

  async function submit(): Promise<void> {
    page().querySelector('form')?.dispatchEvent(new Event('submit'));
    await settle(harness.fixture);
  }

  beforeEach(() => {
    login = vi.fn(() => Promise.resolve());
    methods = { oidc: 'not-configured', passwordReset: false };
    sessionStorage.clear();
  });

  describe('OIDC', () => {
    const oidcLink = () => page().querySelector('a[href="/api/v1/auth/oidc/start"]') as HTMLAnchorElement | null;
    const banners = () => [ ...page().querySelectorAll('ui-inline-banner') ];

    it('offers no OIDC login when it is not configured', async () => {
      await open();
      expect(oidcLink()).toBeNull();
      expect(page().textContent).not.toContain(`${KEY}.oidcUnavailable`);
    });

    it('shows Log in with OIDC when available', async () => {
      methods = { oidc: 'available', passwordReset: false };
      await open('/login?returnUrl=%2Frepositories%2F3');

      expect(oidcLink()?.textContent).toContain(`${KEY}.oidc`);
      oidcLink()?.addEventListener('click', event => event.preventDefault());
      oidcLink()?.click();
      expect(sessionStorage.getItem('front-burner.oidc-return')).toBe('/repositories/3');
    });

    it('says OIDC is unavailable', async () => {
      methods = { oidc: 'unavailable', passwordReset: false };
      await open();
      expect(oidcLink()).toBeNull();
      expect(page().textContent).toContain(`${KEY}.oidcUnavailable`);
    });

    it('shows the generic OIDC error', async () => {
      await open('/login?oidcError=failed');
      expect(banners().map(banner => banner.getAttribute('status'))).toEqual([ 'danger' ]);
      expect(banners()[0]?.textContent).toContain('web-feature-auth.oidcErrors.failed');
    });

    it('shows the reason while onboarding is pending from the environment', async () => {
      await open('/login?oidcError=admin-email-mismatch');
      expect(banners()[0]?.textContent).toContain('web-feature-auth.oidcErrors.admin-email-mismatch');
    });

    it('shows an unknown reason as the generic error', async () => {
      await open('/login?oidcError=%3Cb%3E');
      expect(banners()[0]?.textContent).toContain('web-feature-auth.oidcErrors.failed');
    });
  });

  it('is the main landmark with one h1, "Log in"', async () => {
    await open();

    expect(page().querySelectorAll('main')).toHaveLength(1);
    expect(page().querySelectorAll('h1')).toHaveLength(1);
    expect(page().querySelector('h1')?.textContent?.trim()).toBe(`${KEY}.title`);
    expect(page().querySelector('h1')?.getAttribute('tabindex')).toBe('-1');
  });

  it('asks for the email and the password with autocomplete', async () => {
    await open();

    expect(email().getAttribute('autocomplete')).toBe('username');
    expect(password().type).toBe('password');
    expect(button().textContent).toContain(`${KEY}.submit`);
  });

  it('disables Log in until both fields are valid', async () => {
    await open();
    expect(button().getAttribute('aria-disabled')).toBe('true');

    await type(email(), 'not-an-email');
    await type(password(), 'x');
    expect(button().getAttribute('aria-disabled')).toBe('true');

    await type(email(), 'ada@example.com');
    expect(button().getAttribute('aria-disabled')).toBeNull();
  });

  it('does not send an invalid form', async () => {
    await open();
    await type(email(), 'ada@example.com');
    await submit();

    expect(login).not.toHaveBeenCalled();
    expect(page().textContent).toContain(`${KEY}.errors.passwordRequired`);
  });

  it('logs in and goes to the return target', async () => {
    await open(`/login?returnUrl=${encodeURIComponent('/repositories/3?tab=changes')}`);
    await fillIn();
    await submit();

    expect(login).toHaveBeenCalledExactlyOnceWith('ada@example.com', 'correct horse');
    expect(TestBed.inject(Router).url).toBe('/repositories/3?tab=changes');
  });

  it('goes to the dashboard without a return target', async () => {
    await open();
    await fillIn();
    await submit();

    expect(TestBed.inject(Router).url).toBe('/');
  });

  it('goes to the dashboard for a return target outside the web client', async () => {
    await open(`/login?returnUrl=${encodeURIComponent('//evil.example')}`);
    await fillIn();
    await submit();

    expect(TestBed.inject(Router).url).toBe('/');
  });

  it('is busy while logging in', async () => {
    let finish!: () => void;
    login.mockReturnValue(new Promise<void>(resolve => (finish = resolve)));
    await open();
    await fillIn();
    await submit();

    expect(button().getAttribute('data-busy')).toBe('true');
    expect(button().getAttribute('aria-disabled')).toBe('true');
    finish();
    await settle(harness.fixture);
  });

  it('shows the error and clears the password on wrong credentials', async () => {
    login.mockRejectedValue(apiError('wrong-credentials', 401));
    await open();
    await fillIn();
    await submit();

    const banner = page().querySelector('ui-inline-banner[status="danger"]');
    expect(banner?.textContent).toContain('wrong-credentials message');
    expect(banner?.textContent).not.toContain('abcdef12');
    expect(password().value).toBe('');
    expect(document.activeElement).toBe(password());
    expect(email().value).toBe('ada@example.com');
    expect(page().textContent).not.toContain(`${KEY}.errors.passwordRequired`);
    expect(TestBed.inject(Router).url).toBe('/login');
  });

  it('shows other errors with the request reference', async () => {
    login.mockRejectedValue(apiError('rate-limited', 429));
    await open();
    await fillIn();
    await submit();

    const banner = page().querySelector('ui-inline-banner[status="danger"]');
    expect(banner?.textContent).toContain('rate-limited message');
    expect(banner?.textContent).toContain('abcdef12');
    expect(password().value).toBe('correct horse');
  });

  it.each([ 'logged-out', 'session-expired' ])('shows the one-off message %s', async loginMessage => {
    await open('/login', { state: { loginMessage } });

    expect(page().querySelector('ui-inline-banner[status="info"]')?.textContent).toContain(
      `${KEY}.messages.${loginMessage}`
    );
  });

  it('shows no message without one, or for an unknown one', async () => {
    await open('/login', { state: { loginMessage: 'something-else' } });

    expect(page().querySelector('ui-inline-banner[status="info"]')).toBeNull();
  });

  it('AC-AUTH-003.26: warns on plain HTTP away from localhost', async () => {
    await open('/login', { location: { protocol: 'http:', hostname: 'fb.example' } });

    const banner = page().querySelector('ui-inline-banner[status="warning"]');
    expect(banner?.textContent).toContain(`${KEY}.insecure`);
    expect(banner?.querySelector('a')?.getAttribute('href')).toBe(
      'https://github.com/Auxx/front-burner/blob/master/docs/wiki/deployment.md'
    );
  });

  it.each([ 'localhost', '127.0.0.1', '[::1]' ])('AC-AUTH-003.26: does not warn on %s', async hostname => {
    await open('/login', { location: { protocol: 'http:', hostname } });

    expect(page().querySelector('ui-inline-banner[status="warning"]')).toBeNull();
  });

  it('AC-AUTH-003.26: does not warn over HTTPS', async () => {
    await open();

    expect(page().querySelector('ui-inline-banner[status="warning"]')).toBeNull();
  });

  it('AC-AUTH-003.23: has no Forgot password? link without SMTP', async () => {
    await open();

    const links = [ ...page().querySelectorAll('a') ].map(link => `${link.getAttribute('href')} ${link.textContent}`);
    expect(links.filter(link => /forgot|reset/i.test(link))).toEqual([]);
  });
});
