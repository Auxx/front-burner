import { Config } from '@front-burner/server-core-config';
import { DynamicModule, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import type { DestinationStream } from 'pino';
import { HttpLogger, Options, pinoHttp } from 'pino-http';
import { createLoggerOptions } from './logger-options';

/** Header that carries the request ID back to the client (NF-10.6). */
export const REQUEST_ID_HEADER = 'X-Request-Id';

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
    customProps: req => ({ requestId: req.id })
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
