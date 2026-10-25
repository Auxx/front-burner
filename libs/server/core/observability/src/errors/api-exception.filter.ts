import type { ApiError, ErrorCode, FieldError } from '@front-burner/shared-contracts';
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger, NotFoundException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ZodValidationException } from 'nestjs-zod';
import { randomUUID } from 'node:crypto';
import type { Logger as PinoLogger } from 'pino';
import { ApiErrorException } from './api-error.exception';

/** English fallback text per code (A-3.3); clients translate by `code`. */
const MESSAGES: Record<ErrorCode, string> = {
  'not-found': 'Not found.',
  'validation-failed': 'The request is invalid.',
  'malformed-request': 'The request could not be read.',
  'payload-too-large': 'The request is too large.',
  'rate-limited': 'Too many requests. Try again later.',
  internal: 'Something went wrong.'
};

interface ZodIssueLike {
  path: PropertyKey[];
  code: string;
  message?: string;
  input?: unknown;
  params?: Record<string, unknown>;
  [detail: string]: unknown;
}

interface Answer {
  status: number;
  code: string;
  params: Record<string, unknown>;
  message?: string;
  fields?: FieldError[];
}

/** Turns every exception into an `ApiError` body carrying the request ID (A-3.3). */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request & { id?: string | number; log?: PinoLogger; }>();
    const res = http.getResponse<Response>();

    // pino-http sets the ID; a parser error can come before it ran.
    const requestId = req.id !== undefined
      ? String(req.id)
      : (res.getHeader('X-Request-Id') as string | undefined) ?? randomUUID();
    if (!res.hasHeader('X-Request-Id')) {
      res.setHeader('X-Request-Id', requestId);
    }

    const answer = this.answer(exception);
    if (answer.status >= 500) {
      const error = exception instanceof Error ? exception : new Error(String(exception));
      if (req.log) {
        req.log.error({ err: error }, 'Unhandled exception');
      } else {
        this.logger.error('Unhandled exception', error.stack);
      }
    }

    const body: ApiError = {
      code: answer.code,
      params: answer.params,
      requestId,
      message: answer.message ?? MESSAGES[answer.code as ErrorCode] ?? answer.code,
      ...(answer.fields ? { fields: answer.fields } : {})
    };
    res.status(answer.status).json(body);
  }

  private answer(exception: unknown): Answer {
    if (exception instanceof ApiErrorException) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        params: exception.params,
        message: exception.fallbackMessage
      };
    }
    if (exception instanceof ZodValidationException) {
      return { status: 400, code: 'validation-failed', params: {}, fields: this.fields(exception.getZodError()) };
    }
    if (exception instanceof NotFoundException) {
      return { status: 404, code: 'not-found', params: {} };
    }
    if (exception instanceof ThrottlerException) {
      return { status: 429, code: 'rate-limited', params: {} };
    }
    if (exception instanceof HttpException && exception.getStatus() < 500) {
      return {
        status: exception.getStatus(),
        code: exception.getStatus() === 404 ? 'not-found' : 'malformed-request',
        params: {}
      };
    }
    const type = (exception as { type?: unknown; } | null)?.type;
    if (type === 'entity.parse.failed') {
      return { status: 400, code: 'malformed-request', params: {} };
    }
    if (type === 'entity.too.large') {
      return { status: 413, code: 'payload-too-large', params: {} };
    }
    return { status: 500, code: 'internal', params: {} };
  }

  private fields(zodError: unknown): FieldError[] {
    const issues = (zodError as { issues?: ZodIssueLike[]; } | null)?.issues ?? [];
    return issues.map(issue => {
      // `input` is the user's value: never echoed back.
      const { path, code, message: _message, input: _input, params, ...details } = issue;
      const { code: schemaCode, ...schemaParams } = params ?? {};
      return {
        path: path.map(String).join('.'),
        code: typeof schemaCode === 'string' ? schemaCode : code.replace(/_/g, '-'),
        params: { ...details, ...schemaParams }
      };
    });
  }
}
