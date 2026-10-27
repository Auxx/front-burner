import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { OnboardingStatus } from '@front-burner/shared-contracts';

import { OnboardingStateService, type OnboardingView } from '../../services/onboarding-state/onboarding-state.service';
import { onboardingGuard } from './onboarding.guard';

@Component({ template: '' })
class BlankComponent {}

const status = (state: OnboardingStatus['state'], oidcFromEnvironment = false): OnboardingView => ({
  kind: 'status',
  status: { state, oidcFromEnvironment, setupTokenConfigured: true }
});

const failed: OnboardingView = {
  kind: 'error',
  cause: new Error('offline')
};

describe('onboardingGuard', () => {
  async function navigate(view: OnboardingView, url: string): Promise<string> {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          {
            path: '',
            canActivateChild: [ onboardingGuard ],
            children: [
              { path: 'onboarding', component: BlankComponent },
              { path: 'login', component: BlankComponent },
              { path: 'login/oidc', component: BlankComponent },
              { path: 'repositories', component: BlankComponent },
              { path: '**', redirectTo: 'login' }
            ]
          }
        ]),
        { provide: OnboardingStateService, useValue: { load: () => Promise.resolve(view) } }
      ]
    });
    const router = TestBed.inject(Router);
    await router.navigateByUrl(url);
    return router.url;
  }

  it.each(
    [
      [ 'required', '/onboarding', '/onboarding' ],
      [ 'required', '/login', '/onboarding' ],
      [ 'required', '/no/such/page', '/onboarding' ],
      [ 'completed', '/onboarding', '/login' ],
      [ 'completed', '/login', '/login' ],
      [ 'completed', '/repositories', '/repositories' ]
    ] as const
  )('%s: %s ends on %s', async (state, url, expected) => {
    expect(await navigate(status(state), url)).toBe(expected);
  });

  it.each([
    [ '/onboarding', '/onboarding' ],
    [ '/login', '/login' ],
    [ '/login/oidc?code=abc', '/login/oidc?code=abc' ],
    [ '/repositories', '/onboarding' ]
  ])('oidc-pending from the onboarding page: %s ends on %s', async (url, expected) => {
    expect(await navigate(status('oidc-pending'), url)).toBe(expected);
  });

  it.each([
    [ '/onboarding', '/login' ],
    [ '/login', '/login' ],
    [ '/login/oidc?code=abc', '/login/oidc?code=abc' ],
    [ '/repositories', '/repositories' ]
  ])('oidc-pending from the environment: %s ends on %s', async (url, expected) => {
    expect(await navigate(status('oidc-pending', true), url)).toBe(expected);
  });

  it('sends to onboarding with the error when the state request fails', async () => {
    expect(await navigate(failed, '/login')).toBe('/onboarding');
    TestBed.resetTestingModule();
    expect(await navigate(failed, '/onboarding')).toBe('/onboarding');
  });
});
