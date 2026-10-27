import { Route } from '@angular/router';

import { unsavedChangesGuard } from './guards/unsaved-changes/unsaved-changes.guard';
import { AddRepositoryPage } from './pages/add-repository/add-repository.page';

export const routes: Route[] = [
  {
    path: 'new',
    component: AddRepositoryPage,
    title: 'web-feature-repositories.AddRepositoryPage.title',
    canDeactivate: [ unsavedChangesGuard ]
  }
];
