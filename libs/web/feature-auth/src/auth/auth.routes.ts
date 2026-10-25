import { Route } from '@angular/router';

import { LoginPage } from './pages/login/login.page';
import { OnboardingPage } from './pages/onboarding/onboarding.page';

export const routes: Route[] = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  { path: 'login', component: LoginPage, title: 'web-feature-auth.LoginPage.title' },
  { path: 'onboarding', component: OnboardingPage, title: 'web-feature-auth.OnboardingPage.title' }
];
