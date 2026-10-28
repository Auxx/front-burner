import { Route } from '@angular/router';

import { RepositoryScreenPage } from './pages/repository-screen/repository-screen.page';
import { repositoryScreenMatcher } from './utils/repository-screen-matcher/repository-screen-matcher';

export const routes: Route[] = [
  // The page titles itself with the repository's name (NV-13).
  { matcher: repositoryScreenMatcher, component: RepositoryScreenPage, data: { ownTitle: true } }
];
