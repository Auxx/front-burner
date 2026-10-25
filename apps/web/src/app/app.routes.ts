import { Route } from '@angular/router';

export const appRoutes: Route[] = [
  {
    path: '',
    loadChildren: () => import('@front-burner/web-feature-auth').then(m => m.authRoutes)
  },
  { path: '**', redirectTo: 'login' }
];
