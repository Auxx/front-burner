import { Route, UrlSegment } from '@angular/router';
import { isRepositoryId } from '@front-burner/web-core';

import { unsavedChangesGuard } from './guards/unsaved-changes/unsaved-changes.guard';
import { AddRepositoryPage } from './pages/add-repository/add-repository.page';
import { RepositoriesPage } from './pages/repositories/repositories.page';
import { RepositorySettingsPage } from './pages/repository-settings/repository-settings.page';

export const routes: Route[] = [
  {
    path: '',
    pathMatch: 'full',
    component: RepositoriesPage,
    title: 'web-feature-repositories.RepositoriesPage.title'
  },
  {
    path: 'new',
    component: AddRepositoryPage,
    title: 'web-feature-repositories.AddRepositoryPage.title',
    canDeactivate: [ unsavedChangesGuard ]
  },
  {
    // A malformed ID matches nothing here, so it is Page not found, like a missing repository (RM-1).
    path: ':id/settings',
    canMatch: [ (_route: Route, segments: UrlSegment[]) => isRepositoryId(segments[0]?.path ?? '') ],
    component: RepositorySettingsPage,
    // The page titles itself with the repository's name (NV-13).
    data: { ownTitle: true }
  }
];
