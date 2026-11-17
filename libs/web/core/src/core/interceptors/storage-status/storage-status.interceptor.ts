import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject, Injector } from '@angular/core';
import { catchError, map, switchMap, throwError } from 'rxjs';

import { errorCode } from '../../errors/error-code';
import { StorageStatusService } from '../../services/storage-status/storage-status.service';

/**
 * After a `low-storage` error, such as a refused clone, has the storage
 * status read the state again, so that an administrator sees the low-space
 * banner at once (NF-9.7). The error goes on unchanged. The service is looked
 * up only then: it uses `HttpClient` itself.
 */
export const storageStatusInterceptor: HttpInterceptorFn = (request, next) => {
  const injector = inject(Injector);
  return next(request).pipe(catchError((error: unknown) => {
    if (!(error instanceof HttpErrorResponse) || error.status !== 507) {
      return throwError(() => error);
    }
    return errorCode(error).pipe(
      map(code => {
        if (code === 'low-storage') {
          injector.get(StorageStatusService).refresh();
        }
      }),
      switchMap(() => throwError(() => error))
    );
  }));
};
