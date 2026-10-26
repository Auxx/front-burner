import { Config, ConfigModule } from '@front-burner/server-core-config';
import { Database, DatabaseModule } from '@front-burner/server-core-database';
import { ApiExceptionFilter, HealthModule, LoggingModule } from '@front-burner/server-core-observability';
import { RateLimitModule } from '@front-burner/server-core-security';
import { AuthModule } from '@front-burner/server-feature-auth';
import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import type { HttpLogger } from 'pino-http';

export interface AppModuleDeps {
  config: Config;
  database: Database;
  migrationsApplied: boolean;
  /** The request logger, attached to the application before everything else. */
  requestLogger: HttpLogger;
}

@Module({})
export class AppModule {
  static register(deps: AppModuleDeps): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(deps.config),
        DatabaseModule.forRoot(deps.database),
        LoggingModule.forRoot(deps.requestLogger),
        RateLimitModule,
        HealthModule.forRoot({ migrationsApplied: deps.migrationsApplied }),
        // After RateLimitModule: the rate limit guard runs before the auth guard (A-1.12).
        AuthModule
      ],
      providers: [
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor }
      ]
    };
  }
}
