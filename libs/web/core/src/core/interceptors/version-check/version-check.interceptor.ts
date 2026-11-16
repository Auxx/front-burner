import { HttpErrorResponse, type HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { tap } from 'rxjs';

import { VersionCheckService } from '../../services/version-check/version-check.service';

/** The backend's version, on every response but the health probes' (NF-7.6). */
const VERSION_HEADER = 'X-Front-Burner-Version';

/**
 * Reports the version header of every response, an error's too, to the
 * version check (A-8.7). A response without it, such as a proxy's error page,
 * changes nothing.
 */
export const versionCheckInterceptor: HttpInterceptorFn = (request, next) => {
  const versions = inject(VersionCheckService);
  return next(request).pipe(tap({
    next: event => {
      if (event instanceof HttpResponse) {
        versions.seen(event.headers.get(VERSION_HEADER));
      }
    },
    error: (error: unknown) => {
      if (error instanceof HttpErrorResponse) {
        versions.seen(error.headers.get(VERSION_HEADER));
      }
    }
  }));
};
