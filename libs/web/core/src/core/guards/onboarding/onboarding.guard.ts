import { inject } from '@angular/core';
import { type CanActivateChildFn, Router, type UrlTree } from '@angular/router';

import { OnboardingStateService, type OnboardingView } from '../../services/onboarding-state/onboarding-state.service';

const ONBOARDING = '/onboarding';
const LOGIN = '/login';

/** Where a URL may go for a given onboarding state: `true`, or the URL to go to instead. */
function destination(view: OnboardingView, url: string): string | true {
  const toOnboarding = url === ONBOARDING || url.startsWith(`${ONBOARDING}?`) || url.startsWith(`${ONBOARDING}/`);
  // The onboarding page shows the error and offers a retry.
  if (view.kind === 'error') {
    return toOnboarding || ONBOARDING;
  }
  const { state, oidcFromEnvironment } = view.status;
  if (state === 'completed' || (state === 'oidc-pending' && oidcFromEnvironment)) {
    // AO-3, AO-33: the onboarding page cannot be reached.
    return toOnboarding ? LOGIN : true;
  }
  if (toOnboarding) {
    return true;
  }
  // AO-2: while pending from the onboarding page, the login page stays open for trying OIDC.
  const isLogin = url === LOGIN || url.startsWith(`${LOGIN}?`);
  return state === 'oidc-pending' && isLogin ? true : ONBOARDING;
}

/**
 * Sends every route to the Administrator onboarding page while onboarding is
 * open, and the onboarding page to the login page once it is closed (AO-2,
 * AO-3). Put it on the parent of every route of the web client.
 */
export const onboardingGuard: CanActivateChildFn = async (_route, state): Promise<boolean | UrlTree> => {
  const router = inject(Router);
  const target = destination(await inject(OnboardingStateService).load(), state.url);
  return target === true ? true : router.parseUrl(target);
};
