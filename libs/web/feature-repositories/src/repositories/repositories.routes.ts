import { Route } from '@angular/router';

import { unsavedChangesGuard } from './guards/unsaved-changes/unsaved-changes.guard';
import { AddRepositoryPage } from './pages/add-repository/add-repository.page';
import { RepositoriesPage } from './pages/repositories/repositories.page';

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
  }
];
