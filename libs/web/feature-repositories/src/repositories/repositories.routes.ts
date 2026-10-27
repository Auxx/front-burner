import { Route } from '@angular/router';

import { AddRepositoryPage } from './pages/add-repository/add-repository.page';

export const routes: Route[] = [
  { path: 'new', component: AddRepositoryPage, title: 'web-feature-repositories.AddRepositoryPage.title' }
];
