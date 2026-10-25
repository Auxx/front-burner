import { HttpErrorResponse } from '@angular/common/http';
import { type ApiError, ApiErrorSchema } from '@front-burner/shared-contracts';

/** Normalises whatever a failed request threw into an `ApiError` (A-8.6). */
export function toApiError(error: unknown): ApiError {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) {
      return { code: 'network', params: {}, requestId: '', message: 'Network error' };
    }
    const parsed = ApiErrorSchema.safeParse(error.error);
    if (parsed.success) {
      return parsed.data;
    }
    return {
      code: 'internal',
      params: {},
      requestId: error.headers.get('X-Request-Id') ?? '',
      message: 'Internal error'
    };
  }
  return { code: 'internal', params: {}, requestId: '', message: 'Internal error' };
}
