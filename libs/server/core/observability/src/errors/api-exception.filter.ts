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
  internal: 'Something went wrong.',
  unauthenticated: 'Log in to continue.',
  'auth-token-expired': 'The auth token has expired.',
  'wrong-credentials': 'Wrong username or password',
  'refresh-refused': 'Your session has expired. Please log in again',
  'cross-site-refused': 'The request came from another site.',
  'oidc-code-invalid': 'OIDC login failed',
  'too-many-jobs': 'Too many tasks are waiting. Wait for one to finish and try again.',
  'key-locked': 'Enter the passphrase of this key to unlock it for this session.',
  'unlock-too-many-attempts': 'Too many attempts. Try again in a minute.',
  'credentials-missing': 'These saved credentials are no longer available. Add them again.',
  'credentials-not-updatable': 'This repository doesn\'t use saved HTTPS credentials that can be updated.',
  'host-key-changed': 'The server\'s identity has changed. This may be an attack.',
  'remote-timeout': 'The remote didn\'t answer in time. Try again later.',
  'remote-failed': 'Something went wrong while contacting the remote.',
  'host-key-unknown': 'The server\'s host key is not known yet.',
  'host-key-not-trusted': 'No key is trusted for this server yet, so there is none to replace.',
  'path-refused': 'This path can\'t be used.',
  'entry-not-found': 'This file or folder doesn\'t exist.',
  'repository-not-openable': 'This repository can\'t be opened yet.',
  'merge-in-progress': 'A merge is in progress. Finish or abort it first.',
  'file-too-large': 'This file is too large to edit (the limit is 1 MB).',
  'file-not-utf8': 'This file isn\'t UTF-8 text, so it can\'t be edited safely.',
  'entry-not-editable': 'Only Markdown files can be opened in Front Burner.',
  'entry-exists': 'A file with this name exists again.',
  'image-format-unsupported': 'This image format isn\'t supported',
  'image-too-large': 'This image is too large to preview',
  'commit-author-not-confirmed': 'Confirm your commit author before your first commit.',
  'nothing-to-commit': 'There is nothing to commit. These files have no changes.',
  'detached-head': 'HEAD is not on a branch. Switch to a branch before committing.',
  'amend-not-allowed':
    'The last commit can\'t be amended: it was pushed, it\'s a merge commit, or there isn\'t one yet.',
  'discard-blocked':
    'Another file or folder is where this file goes. Move or remove it first, or discard it too if it is in Changes.',
  'git-timeout': 'Git took too long. Try again.',
  'no-branch': 'You\'re not on a branch. Switch to a branch before you push.',
  'no-commits': 'This branch has no commits yet. Commit before you push.',
  'nothing-to-push': 'There is nothing to push.',
  'no-credentials': 'This repository has no credentials. Add credentials to push.',
  'credentials-refused': 'The remote refused your credentials.',
  'push-not-allowed': 'Your credentials can read this repository but not push to it.',
  'push-non-fast-forward': 'The remote has new commits. Pull first.',
  'push-protected-branch': 'The remote refused the push to a protected branch.',
  'push-unsigned': 'The remote accepts only signed commits.',
  'push-rejected': 'The remote refused the push.',
  'host-unreachable': 'The remote can\'t be reached.',
  'tls-untrusted': 'The remote\'s certificate isn\'t trusted.',
  'repository-not-found': 'The remote repository wasn\'t found.',
  interrupted: 'This was interrupted by a restart. Try again.'
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
        message: exception.fallbackMessage,
        fields: exception.fields
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
    // Deliberate plan choice: any other client error is reported as malformed-request.
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
