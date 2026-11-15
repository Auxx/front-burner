import { HttpErrorResponse } from '@angular/common/http';

/** A failed request as the API answers it, with an `ApiError` body (A-8.6). */
export function apiFailure(status: number, code: string): HttpErrorResponse {
  return new HttpErrorResponse({ status, error: { code, params: {}, requestId: 'req-1', message: code } });
}
