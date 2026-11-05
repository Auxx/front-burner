import { HttpErrorResponse } from '@angular/common/http';

/** The `4xx` answers that are passing: another try can go differently. */
const PASSING_STATUSES = new Set([ 408, 429 ]);

/**
 * Whether the backend refused the request, so that sending it again would not
 * change the answer. A network error, a `5xx`, a `408` and a `429` are passing.
 */
export function isRefusal(error: unknown): boolean {
  return error instanceof HttpErrorResponse && error.status >= 400 && error.status < 500
    && !PASSING_STATUSES.has(error.status);
}
