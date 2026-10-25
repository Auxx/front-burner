import { Config, ConfigError, loadConfig } from '@front-burner/server-core-config';
import { applyMigrations, assertNoNewerMigrations, Database, openDatabase } from '@front-burner/server-core-database';
import { createBootstrapLogger, createRequestLogger } from '@front-burner/server-core-observability';
import { securityHeaders, serveWebClient } from '@front-burner/server-core-security';
import { INestApplication, Logger as NestLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import type { DestinationStream, Logger as PinoLogger } from 'pino';
import type { HttpLogger } from 'pino-http';
import { AppModule } from '../app/app.module';
import { prepareDataDir } from './prepare-data-dir';

export type StartupStep = 'config' | 'data-dir' | 'database' | 'migrations' | 'http';

/** A startup step failed (A-1.11); `cause` holds the reason. */
export class StartupError extends Error {
  constructor(readonly step: StartupStep, override readonly cause: unknown) {
    super(`Startup failed at step "${step}": ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'StartupError';
  }
}

export interface StartServerOptions {
  env: Record<string, string | undefined>;
  cwd?: string;
  webRoot: string;
  migrationsFolder: string;
  listen: boolean;
  /** Replaces stdout as the log destination; meant for tests. */
  logDestination?: DestinationStream;
}

function step<T>(name: StartupStep, run: () => T): T {
  try {
    return run();
  } catch (error) {
    throw new StartupError(name, error);
  }
}

/**
 * The logger for startup lines. Once the configuration parses, it honours
 * `FRONT_BURNER_LOG_LEVEL` and `FRONT_BURNER_LOG_FORMAT`; when it does not,
 * nothing can be trusted and the lines are JSON at `info`.
 */
export function bootstrapLoggerFor(
  env: Record<string, string | undefined>,
  destination?: DestinationStream
): PinoLogger {
  try {
    return createBootstrapLogger(loadConfig(env, { cwd: '/' }).config, destination);
  } catch {
    return createBootstrapLogger(undefined, destination);
  }
}

/** Logs why startup failed; a failed configuration also prints its warnings (A-1.11). */
export function logStartupFailure(
  error: unknown,
  env: Record<string, string | undefined>,
  destination?: DestinationStream
): void {
  const logger = bootstrapLoggerFor(env, destination);
  if (error instanceof StartupError) {
    if (error.cause instanceof ConfigError) {
      for (const warning of error.cause.warnings) {
        logger.warn(warning);
      }
    }
    logger.fatal({ step: error.step, err: error.cause }, error.message);
  } else {
    logger.fatal({ err: error }, 'Startup failed');
  }
}

function configure(
  app: NestExpressApplication,
  config: Config,
  webRoot: string,
  requestLogger: HttpLogger
): void {
  app.useLogger(app.get(Logger));
  app.flushLogs();
  const log = new NestLogger('Startup');
  log.log(`Data directory: ${config.dataDir}`);

  app.set('trust proxy', config.trustedProxies);
  // First, so that every response has an ID and is logged (NF-10.6, A-1.12).
  app.use(requestLogger);
  app.use(securityHeaders());
  // Nest's own parser is off so that the limit of NF-11.5 applies.
  app.useBodyParser('json', { limit: '2mb' });
  // The health probes keep their path outside the API version (NF-10.7).
  app.setGlobalPrefix('api/v1', { exclude: [ 'api/health/live', 'api/health/ready' ] });
  if (!serveWebClient(app.getHttpAdapter().getInstance(), webRoot)) {
    log.log(`Web client not found at ${webRoot}; serving the API only.`);
  }
  app.enableShutdownHooks();
}

/**
 * Runs the startup sequence of A-1.11: configuration, data directory,
 * database, migrations, then the HTTP server. With `listen: false` the
 * application is built but not bound to a port.
 *
 * @throws StartupError naming the step that failed.
 */
export async function startServer(options: StartServerOptions): Promise<INestApplication> {
  const { config, warnings } = step('config', () => loadConfig(options.env, { cwd: options.cwd }));
  const bootstrapLogger = createBootstrapLogger(config, options.logDestination);
  for (const warning of warnings) {
    bootstrapLogger.warn(warning);
  }
  const { databaseFile } = step('data-dir', () => prepareDataDir(config.dataDir));
  const database: Database = step('database', () => openDatabase(databaseFile));

  try {
    step('migrations', () => {
      assertNoNewerMigrations(database, options.migrationsFolder);
      applyMigrations(database, options.migrationsFolder);
    });
    const requestLogger = createRequestLogger(config, options.logDestination);
    const app = await NestFactory.create<NestExpressApplication>(
      AppModule.register({
        config,
        database,
        migrationsApplied: true,
        requestLogger
      }),
      { bodyParser: false, bufferLogs: true }
    ).catch((error: unknown) => {
      throw new StartupError('http', error);
    });
    try {
      configure(app, config, options.webRoot, requestLogger);
      if (options.listen) {
        await app.listen(config.port);
      } else {
        await app.init();
      }
    } catch (error) {
      await app.close().catch(() => undefined);
      throw new StartupError('http', error);
    }
    return app;
  } catch (error) {
    database.sqlite.close();
    throw error;
  }
}
