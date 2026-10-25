import { Route } from '@angular/router';

import { LoginPage } from './pages/login/login.page';

export const routes: Route[] = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  { path: 'login', component: LoginPage, title: 'web-feature-auth.LoginPage.title' }
];
