import { Route, UrlSegment } from '@angular/router';
import { authGuard, onboardingGuard } from '@front-burner/web-core/app';

export const appRoutes: Route[] = [
  {
    // Every route sits under the onboarding guard (AO-2, AO-3).
    path: '',
    canActivateChild: [ onboardingGuard ],
    children: [
      {
        path: '',
        // `/` is the dashboard's: an empty URL would otherwise match here, with none of the children.
        canMatch: [ (_route: Route, segments: UrlSegment[]) => segments.length > 0 ],
        loadChildren: () => import('@front-burner/web-feature-auth').then(m => m.authRoutes)
      },
      {
        // The app header and the page in `main`, loaded with the first page that needs them (NF-2.9).
        path: '',
        loadComponent: () => import('@front-burner/web-shell').then(m => m.ShellLayoutComponent),
        children: [
          {
            path: '',
            pathMatch: 'full',
            canActivate: [ authGuard ],
            loadChildren: () => import('@front-burner/web-feature-dashboard').then(m => m.dashboardRoutes)
          },
          {
            // NV-3: with the app header when logged in, without it otherwise.
            path: '**',
            title: 'web-shell.PageNotFoundPage.title',
            loadComponent: () => import('@front-burner/web-shell').then(m => m.PageNotFoundPage)
          }
        ]
      }
    ]
  }
];
