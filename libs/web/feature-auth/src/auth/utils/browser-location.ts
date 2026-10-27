import { DOCUMENT } from '@angular/common';
import { inject, InjectionToken } from '@angular/core';

/** The address the web client was opened from; a token, so that specs can pretend another one. */
export const BROWSER_LOCATION = new InjectionToken<Pick<Location, 'protocol' | 'hostname'>>('BROWSER_LOCATION', {
  factory: () => inject(DOCUMENT).location
});
