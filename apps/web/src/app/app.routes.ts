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
        // The repository screen has its own bar in place of the app header (NV-9).
        path: 'repositories/:id',
        canMatch: [ (_route: Route, segments: UrlSegment[]) => /^\d+$/.test(segments[1]?.path ?? '') ],
        canActivate: [ authGuard ],
        loadChildren: () => import('@front-burner/web-feature-repository-screen').then(m => m.repositoryScreenRoutes)
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
            path: 'repositories',
            // `/repositories` itself has no page until the repository management page (REQ-REPO-003).
            canMatch: [ (_route: Route, segments: UrlSegment[]) => segments.length > 1 ],
            canActivate: [ authGuard ],
            loadChildren: () => import('@front-burner/web-feature-repositories').then(m => m.repositoriesRoutes)
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
