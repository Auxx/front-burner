import type { HttpErrorResponse } from '@angular/common/http';
import { from, type Observable, of } from 'rxjs';

/** The `code` of an error body, or `undefined` when it has none. */
export function codeOf(body: unknown): unknown {
  return typeof body === 'object' && body !== null ? (body as { code?: unknown; }).code : undefined;
}

/**
 * The error's code, for interceptors, which see errors before `toApiError`;
 * a request for raw bytes, such as an image (A-3.14), gets its error as a
 * `Blob` to read first.
 */
export function errorCode(error: HttpErrorResponse): Observable<unknown> {
  const body: unknown = error.error;
  if (!(body instanceof Blob)) {
    return of(codeOf(body));
  }
  return from(
    readText(body).then(text => {
      try {
        return codeOf(JSON.parse(text));
      } catch {
        return undefined;
      }
    })
  );
}

// `FileReader` rather than `Blob.text()`, which the tests' DOM lacks.
function readText(blob: Blob): Promise<string> {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => resolve('');
    reader.readAsText(blob);
  });
}
