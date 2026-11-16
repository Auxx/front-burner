import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withRouterConfig } from '@angular/router';
import { APP_VERSION, provideCore } from '@front-burner/web-core/app';

// Only `version` is bundled. The backend's build reads the same field, so the
// two always match (A-8.7).
// eslint-disable-next-line @nx/enforce-module-boundaries -- the root package.json is no project; it holds the version.
import { version } from '../../../../package.json';
import { appRoutes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideCore(),
    { provide: APP_VERSION, useValue: version },
    // A guard that cancels a Back (AR-48) leaves the browser history as it was,
    // rather than replacing the previous entry with the current page.
    provideRouter(appRoutes, withRouterConfig({ canceledNavigationResolution: 'computed' }))
  ]
};
