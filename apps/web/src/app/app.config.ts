import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withRouterConfig } from '@angular/router';
import { provideCore } from '@front-burner/web-core/app';

import { appRoutes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideCore(),
    // A guard that cancels a Back (AR-48) leaves the browser history as it was,
    // rather than replacing the previous entry with the current page.
    provideRouter(appRoutes, withRouterConfig({ canceledNavigationResolution: 'computed' }))
  ]
};
