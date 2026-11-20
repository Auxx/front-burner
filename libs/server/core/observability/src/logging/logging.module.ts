import { Config } from '@front-burner/server-core-config';
import { DynamicModule, Module } from '@nestjs/common';
import type { Request } from 'express';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { DestinationStream } from 'pino';
import { HttpLogger, Options, pinoHttp } from 'pino-http';
import { routeOf, UNMATCHED_ROUTE } from '../metrics/http-metrics.middleware';
import { createLoggerOptions } from './logger-options';
import { urlForLog } from './request-url';

/** Header that carries the request ID back to the client (NF-10.6). */
export const REQUEST_ID_HEADER = 'X-Request-Id';

/** A request as pino-http's own serializer gives it; only the fields that can hold a path are named. */
interface SerializedRequest {
  url?: string;
  query?: unknown;
  [field: string]: unknown;
}

/** A response as pino-http's own serializer gives it. */
interface SerializedResponse {
  headers?: Record<string, unknown>;
  [field: string]: unknown;
}

/**
 * The serialized request with its URL cut down and its query left out
 * (`urlForLog`). pino-http serializes it when the request arrives, before a
 * route answers, so an API path is cut as if none did; `pathOnCompletion`
 * gives the whole path once one has.
 */
function requestWithoutPaths(req: SerializedRequest): SerializedRequest {
  const rest: SerializedRequest = { ...req };
  delete rest.query;
  return typeof rest.url === 'string' ? { ...rest, url: urlForLog(rest.url) } : rest;
}

/**
 * `path` for the request's last line: its whole path, without the query, when
 * a route answered it, since routes hold only fixed words and IDs.
 */
function pathOnCompletion(req: IncomingMessage): { path?: string; } {
  const express = req as Request;
  if (routeOf(express) === UNMATCHED_ROUTE) {
    return {};
  }
  return { path: urlForLog(express.originalUrl ?? req.url ?? '', true) };
}

/**
 * The serialized response with its redirect's `Location` cut down, which may
 * hold a one-time OIDC code or the provider's `state` (`urlForLog`).
 */
function responseWithoutPaths(res: SerializedResponse): SerializedResponse {
  const location = res.headers?.['location'];
  return typeof location === 'string'
    ? { ...res, headers: { ...res.headers, location: urlForLog(location) } }
    : res;
}

/**
 * The request logger: gives every request its ID (`req.id`, the `X-Request-Id`
 * header and `requestId` in every log line) and logs it when it completes.
 * Attach it with `app.use()` before any other middleware (A-1.12), so that
 * responses of the security headers, body parser and static files carry the
 * ID too. `destination` replaces stdout; meant for tests.
 */
export function createRequestLogger(
  config: Pick<Config, 'logLevel' | 'logFormat'>,
  destination?: DestinationStream
): HttpLogger {
  const options: Options = {
    ...createLoggerOptions(config),
    // The ID goes back to the client in the same step that creates it.
    genReqId: (_req, res) => {
      const id = randomUUID();
      res.setHeader(REQUEST_ID_HEADER, id);
      return id;
    },
    customProps: req => ({ requestId: req.id }),
    // File paths and one-time codes only at debug (NF-10.5): above it, URLs without their query.
    ...(config.logLevel === 'debug'
      ? {}
      : {
        serializers: { req: requestWithoutPaths, res: responseWithoutPaths },
        customSuccessObject: (req, _res, value) => ({ ...value, ...pathOnCompletion(req) }),
        customErrorObject: (req, _res, _error, value) => ({ ...value, ...pathOnCompletion(req) })
      })
  };
  return destination ? pinoHttp(options, destination) : pinoHttp(options);
}

@Module({})
export class LoggingModule {
  /**
   * `requestLogger` is the one from `createRequestLogger`, already attached to
   * the application; Nest only binds its logger to the request context.
   */
  static forRoot(requestLogger: HttpLogger): DynamicModule {
    return {
      module: LoggingModule,
      imports: [
        LoggerModule.forRoot({
          renameContext: 'module',
          useExisting: true,
          pinoHttp: { logger: requestLogger.logger }
        })
      ],
      exports: [ LoggerModule ]
    };
  }
}
