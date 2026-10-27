import { Config, ConfigModule } from '@front-burner/server-core-config';
import { CryptoModule } from '@front-burner/server-core-crypto';
import { Database, DatabaseModule } from '@front-burner/server-core-database';
import { EventsModule } from '@front-burner/server-core-events';
import { GitModule, loadInstanceKnownHosts } from '@front-burner/server-core-git';
import { ApiExceptionFilter, HealthModule, LoggingModule } from '@front-burner/server-core-observability';
import { EgressModule, RateLimitModule } from '@front-burner/server-core-security';
import { AuthModule } from '@front-burner/server-feature-auth';
import { RepositoriesModule } from '@front-burner/server-feature-repositories';
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
  /** The folder of the git helpers shipped with the server (A-5.4). */
  gitHelpersDir: string;
}

@Module({})
export class AppModule {
  static register(deps: AppModuleDeps): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(deps.config),
        DatabaseModule.forRoot(deps.database),
        CryptoModule.forRoot(deps.config),
        EgressModule,
        GitModule.forRoot({
          helpersDir: deps.gitHelpersDir,
          egress: { blockPrivateNetworks: deps.config.blockPrivateNetworks },
          cloneTimeoutMs: deps.config.cloneTimeoutMs,
          gitTimeoutMs: deps.config.gitTimeoutMs,
          knownHosts: loadInstanceKnownHosts(deps.config)
        }),
        LoggingModule.forRoot(deps.requestLogger),
        RateLimitModule,
        HealthModule.forRoot({ migrationsApplied: deps.migrationsApplied }),
        EventsModule,
        // After RateLimitModule: the rate limit guard runs before the auth guard (A-1.12).
        AuthModule,
        RepositoriesModule
      ],
      providers: [
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor }
      ]
    };
  }
}
