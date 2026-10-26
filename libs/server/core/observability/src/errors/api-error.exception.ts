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

  /** A `400 validation-failed` naming the fields, as a refused form submission. */
  static forFields(fields: FieldError[]): ApiErrorException {
    const exception = new ApiErrorException(400, 'validation-failed');
    Object.assign(exception, { fields });
    return exception;
  }
}
