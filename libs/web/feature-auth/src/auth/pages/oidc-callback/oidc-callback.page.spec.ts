import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthSessionService } from '@front-burner/web-core';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { OIDC_RETURN_KEY } from '../../utils/oidc-return';
import { OidcCallbackPage } from './oidc-callback.page';

@Component({ template: '' })
class BlankComponent {}

describe('OidcCallbackPage', () => {
  let completeOidc: ReturnType<typeof vi.fn>;
  let harness: RouterTestingHarness;

  async function open(url: string): Promise<void> {
    TestBed.configureTestingModule({
      imports: [ translocoTesting() ],
      providers: [
        provideRouter([ { path: 'login/oidc', component: OidcCallbackPage }, {
          path: '**',
          component: BlankComponent
        } ]),
        { provide: AuthSessionService, useValue: { completeOidc } }
      ]
    });
    harness = await RouterTestingHarness.create();
    await TestBed.inject(Router).navigateByUrl(url);
    await settle(harness.fixture);
  }

  beforeEach(() => {
    sessionStorage.clear();
    completeOidc = vi.fn(() => Promise.resolve());
  });

  it('shows a spinner while it logs in', async () => {
    completeOidc = vi.fn(() => new Promise(() => undefined));
    await open('/login/oidc?code=abc');

    const page = harness.routeNativeElement as HTMLElement;
    expect(page.querySelector('main ui-spinner')).not.toBeNull();
    expect(page.textContent).toContain('web-feature-auth.OidcCallbackPage.loggingIn');
  });

  it('exchanges the code and returns to the target', async () => {
    sessionStorage.setItem(OIDC_RETURN_KEY, '/repositories/3');
    await open('/login/oidc?code=abc');

    expect(completeOidc).toHaveBeenCalledWith('abc');
    expect(TestBed.inject(Router).url).toBe('/repositories/3');
    expect(sessionStorage.getItem(OIDC_RETURN_KEY)).toBeNull();
  });

  it('goes to the dashboard without a safe target', async () => {
    sessionStorage.setItem(OIDC_RETURN_KEY, '//evil.example.com');
    await open('/login/oidc?code=abc');
    expect(TestBed.inject(Router).url).toBe('/');
  });

  it('goes back to the login page when the exchange fails', async () => {
    completeOidc = vi.fn(() => Promise.reject(new Error('401')));
    await open('/login/oidc?code=abc');
    expect(TestBed.inject(Router).url).toBe('/login?oidcError=failed');
  });

  it('goes back to the login page without a code', async () => {
    await open('/login/oidc');
    expect(completeOidc).not.toHaveBeenCalled();
    expect(TestBed.inject(Router).url).toBe('/login?oidcError=failed');
  });
});
