import { ErrorCode, FieldError } from '@front-burner/shared-contracts';
import { HttpException } from '@nestjs/common';

/**
 * What features throw to answer with an `ApiError` (A-3.3). `code` is an
 * {@link ErrorCode} or a feature's own stable code; the client translates it.
 */
export class ApiErrorException extends HttpException {
  /** Field errors that only the backend can find, answered like Zod's (A-3.9). */
  readonly fields?: FieldError[];

  constructor(
    status: number,
    readonly code: ErrorCode | string,
    readonly params: Record<string, unknown> = {},
    /** English fallback; the filter uses its own text for the shared codes when omitted. */
    readonly fallbackMessage?: string
  ) {
    super(fallbackMessage ?? code, status);
  }

  /** Seconds a client should wait before trying again; sent as `Retry-After` on a `429` (NF-11.4). */
  readonly retryAfterSeconds?: number;

  /** A `429` with the `Retry-After` it is sent with, in whole seconds of at least 1 (NF-11.4). */
  static tooMany(code: ErrorCode, retryAfterSeconds: number): ApiErrorException {
    const exception = new ApiErrorException(429, code);
    Object.assign(exception, { retryAfterSeconds: Math.max(1, Math.ceil(retryAfterSeconds)) });
    return exception;
  }

  /** A `400 validation-failed` naming the fields, as a refused form submission. */
  static forFields(fields: FieldError[]): ApiErrorException {
    const exception = new ApiErrorException(400, 'validation-failed');
    Object.assign(exception, { fields });
    return exception;
  }
}
