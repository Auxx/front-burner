import { Route } from '@angular/router';
import { guestGuard } from '@front-burner/web-core';

import { LoginPage } from './pages/login/login.page';
import { OidcCallbackPage } from './pages/oidc-callback/oidc-callback.page';
import { OnboardingPage } from './pages/onboarding/onboarding.page';

export const routes: Route[] = [
  { path: 'login', component: LoginPage, canActivate: [ guestGuard ], title: 'web-feature-auth.LoginPage.title' },
  { path: 'onboarding', component: OnboardingPage, title: 'web-feature-auth.OnboardingPage.title' },
  {
    path: 'login/oidc',
    component: OidcCallbackPage,
    canActivate: [ guestGuard ],
    title: 'web-feature-auth.LoginPage.title'
  }
];
