import { InjectionToken } from '@angular/core';

/**
 * The version the web client was built with: the root `package.json`'s
 * `version`, as the backend's (NF-7.6). It is the code that runs, so the user
 * menu shows it (NV-7) and the version check compares the backend's with it,
 * for equality only (A-8.7). The application provides it; without it, it is
 * `unknown`, as the backend's is.
 */
export const APP_VERSION = new InjectionToken<string>('APP_VERSION', {
  providedIn: 'root',
  factory: () => 'unknown'
});
