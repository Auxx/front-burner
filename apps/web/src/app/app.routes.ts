import { Route } from '@angular/router';
import { onboardingGuard } from '@front-burner/web-core/app';

export const appRoutes: Route[] = [
  {
    // Every route sits under the onboarding guard (AO-2, AO-3).
    path: '',
    canActivateChild: [ onboardingGuard ],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'login' },
      {
        path: '',
        loadChildren: () => import('@front-burner/web-feature-auth').then(m => m.authRoutes)
      },
      { path: '**', redirectTo: 'login' }
    ]
  }
];
