import { Route } from '@angular/router';
import { guestGuard } from '@front-burner/web-core';

import { LoginPage } from './pages/login/login.page';
import { OnboardingPage } from './pages/onboarding/onboarding.page';

export const routes: Route[] = [
  { path: 'login', component: LoginPage, canActivate: [ guestGuard ], title: 'web-feature-auth.LoginPage.title' },
  { path: 'onboarding', component: OnboardingPage, title: 'web-feature-auth.OnboardingPage.title' }
];
