import { ErrorCode } from '@front-burner/shared-contracts';
import { HttpException } from '@nestjs/common';

/**
 * What features throw to answer with an `ApiError` (A-3.3). `code` is an
 * {@link ErrorCode} or a feature's own stable code; the client translates it.
 */
export class ApiErrorException extends HttpException {
  constructor(
    status: number,
    readonly code: ErrorCode | string,
    readonly params: Record<string, unknown> = {},
    /** English fallback; the filter uses its own text for the shared codes when omitted. */
    readonly fallbackMessage?: string
  ) {
    super(fallbackMessage ?? code, status);
  }
}
