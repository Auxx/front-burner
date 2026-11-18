import { Config, ConfigError, loadConfig } from '@front-burner/server-core-config';
import { checkEncryptionKey, SecretBox } from '@front-burner/server-core-crypto';
import { Database, openDatabase } from '@front-burner/server-core-database';
import { assertHelpersExecutable, assertSupportedGit, GitRunner } from '@front-burner/server-core-git';
import {
  createBootstrapLogger,
  createRequestLogger,
  httpMetrics,
  METRICS_REGISTRY,
  UNVERSIONED_ROUTES
} from '@front-burner/server-core-observability';
import { securityHeaders, serveWebClient, versionHeader } from '@front-burner/server-core-security';
import { INestApplication, Logger as NestLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';
import type { DestinationStream, Logger as PinoLogger } from 'pino';
import type { HttpLogger } from 'pino-http';
import { AppModule } from '../app/app.module';
import { prepareDataDir } from './prepare-data-dir';
import { upgradeDatabase } from './upgrade-database';

export type StartupStep = 'config' | 'data-dir' | 'database' | 'migrations' | 'encryption-key' | 'git' | 'http';

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
  /** The folder of the git helpers shipped with the server (A-5.4). */
  gitHelpersDir: string;
  listen: boolean;
  /** The version the backend was built with (`Config.version`). */
  version?: string;
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

async function stepAsync<T>(name: StartupStep, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
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
  if (config.reposRoot !== config.dataDir) {
    log.log(`Repositories directory: ${config.reposRoot}`);
  }

  app.set('trust proxy', config.trustedProxies);
  // First, so that every response has an ID and is logged (NF-10.6, A-1.12).
  app.use(requestLogger);
  // Next, so that every API request is timed, also those refused before a route (NF-10.11).
  if (config.metricsToken !== undefined) {
    app.use(httpMetrics(app.get(METRICS_REGISTRY)));
  }
  app.use(securityHeaders());
  // The health probes reveal no version (NF-10.9), nor do the metrics, which are not part of the API.
  app.use(versionHeader(config.version, { except: UNVERSIONED_ROUTES }));
  // The refresh token's cookie (LG-32).
  app.use(cookieParser());
  // Nest's own parser is off so that the limit of NF-11.5 applies.
  app.useBodyParser('json', { limit: '2mb' });
  // The health probes and the metrics keep their path outside the API version (NF-10.7, NF-10.10).
  app.setGlobalPrefix('api/v1', { exclude: [ ...UNVERSIONED_ROUTES ] });
  if (!serveWebClient(app.getHttpAdapter().getInstance(), webRoot, { version: config.version })) {
    log.log(`Web client not found at ${webRoot}; serving the API only.`);
  }
  app.enableShutdownHooks();
}

/**
 * Runs the startup sequence of A-1.11: configuration, data directory,
 * database, the pre-upgrade snapshot and migrations, the encryption key check, git and its helpers, then the HTTP server. With `listen: false` the
 * application is built but not bound to a port.
 *
 * @throws StartupError naming the step that failed.
 */
export async function startServer(options: StartServerOptions): Promise<INestApplication> {
  const { config, warnings } = step(
    'config',
    () => loadConfig(options.env, { cwd: options.cwd, version: options.version })
  );
  const bootstrapLogger = createBootstrapLogger(config, options.logDestination);
  for (const warning of warnings) {
    bootstrapLogger.warn(warning);
  }
  const { databaseFile, backupsDir, warnings: dataDirWarnings } = step(
    'data-dir',
    () => prepareDataDir(config.dataDir, config.reposRoot)
  );
  for (const warning of dataDirWarnings) {
    bootstrapLogger.warn(warning);
  }
  const database: Database = step('database', () => openDatabase(databaseFile));

  try {
    step('migrations', () =>
      upgradeDatabase(database, {
        migrationsFolder: options.migrationsFolder,
        backupsDir,
        version: config.version,
        log: message => bootstrapLogger.info(message)
      }));
    const keyCheck = step(
      'encryption-key',
      () => checkEncryptionKey(database, new SecretBox(config.encryptionKey), { reset: config.encryptionKeyReset })
    );
    if (keyCheck === 'reset') {
      bootstrapLogger.warn(
        'FRONT_BURNER_ENCRYPTION_KEY_RESET: every stored secret was deleted and a new check value stored. Remove the variable.'
      );
    } else if (config.encryptionKeyReset) {
      bootstrapLogger.warn(
        'FRONT_BURNER_ENCRYPTION_KEY_RESET is set but the key matches; nothing was deleted. Remove the variable.'
      );
    }
    await stepAsync('git', async () => {
      assertHelpersExecutable(options.gitHelpersDir);
      await assertSupportedGit(new GitRunner());
    });
    const requestLogger = createRequestLogger(config, options.logDestination);
    const app = await NestFactory.create<NestExpressApplication>(
      AppModule.register({
        config,
        database,
        migrationsApplied: true,
        requestLogger,
        gitHelpersDir: options.gitHelpersDir
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
