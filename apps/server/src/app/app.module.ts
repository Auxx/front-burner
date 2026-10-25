import { Config, ConfigModule } from '@front-burner/server-core-config';
import { Database, DatabaseModule } from '@front-burner/server-core-database';
import { ApiExceptionFilter, HealthModule, LoggingModule } from '@front-burner/server-core-observability';
import { RateLimitModule } from '@front-burner/server-core-security';
import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import type { DestinationStream } from 'pino';

export interface AppModuleDeps {
  config: Config;
  database: Database;
  migrationsApplied: boolean;
  /** Replaces stdout as the log destination; meant for tests. */
  logDestination?: DestinationStream;
}

@Module({})
export class AppModule {
  static register(deps: AppModuleDeps): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(deps.config),
        DatabaseModule.forRoot(deps.database),
        LoggingModule.forRoot(deps.config, deps.logDestination),
        RateLimitModule,
        HealthModule.forRoot({ migrationsApplied: deps.migrationsApplied })
      ],
      providers: [
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor }
      ]
    };
  }
}
