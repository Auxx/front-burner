import { Route } from '@angular/router';

import { RepositoryScreenPage } from './pages/repository-screen/repository-screen.page';
import { repositoryScreenMatcher } from './utils/repository-screen-matcher/repository-screen-matcher';

export const routes: Route[] = [
  { matcher: repositoryScreenMatcher, component: RepositoryScreenPage }
];
