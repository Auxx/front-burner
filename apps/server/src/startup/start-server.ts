import { Config, loadConfig } from '@front-burner/server-core-config';
import { applyMigrations, assertNoNewerMigrations, Database, openDatabase } from '@front-burner/server-core-database';
import { securityHeaders, serveWebClient } from '@front-burner/server-core-security';
import { INestApplication, Logger as NestLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
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

function configure(app: NestExpressApplication, config: Config, webRoot: string, warnings: string[]): void {
  app.useLogger(app.get(Logger));
  app.flushLogs();
  const log = new NestLogger('Startup');
  for (const warning of warnings) {
    log.warn(warning);
  }
  log.log(`Data directory: ${config.dataDir}`);

  app.set('trust proxy', config.trustedProxies);
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
  const { databaseFile } = step('data-dir', () => prepareDataDir(config.dataDir));
  const database: Database = step('database', () => openDatabase(databaseFile));

  try {
    step('migrations', () => {
      assertNoNewerMigrations(database, options.migrationsFolder);
      applyMigrations(database, options.migrationsFolder);
    });
    const app = await NestFactory.create<NestExpressApplication>(
      AppModule.register({
        config,
        database,
        migrationsApplied: true,
        logDestination: options.logDestination
      }),
      { bodyParser: false, bufferLogs: true }
    ).catch((error: unknown) => {
      throw new StartupError('http', error);
    });
    try {
      configure(app, config, options.webRoot, warnings);
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
