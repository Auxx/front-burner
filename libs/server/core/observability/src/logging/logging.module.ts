import { Config } from '@front-burner/server-core-config';
import { DynamicModule, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import type { DestinationStream } from 'pino';
import type { Options } from 'pino-http';
import { createLoggerOptions } from './logger-options';

/** Header that carries the request ID back to the client (NF-10.6). */
export const REQUEST_ID_HEADER = 'X-Request-Id';

@Module({})
export class LoggingModule {
  /** `destination` replaces stdout; meant for tests. */
  static forRoot(config: Config, destination?: DestinationStream): DynamicModule {
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
    return {
      module: LoggingModule,
      imports: [
        LoggerModule.forRoot({
          renameContext: 'module',
          pinoHttp: destination ? [ options, destination ] : options
        })
      ],
      exports: [ LoggerModule ]
    };
  }
}
