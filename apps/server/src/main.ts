import { createBootstrapLogger } from '@front-burner/server-core-observability';
import { join, resolve } from 'node:path';
import { startServer, StartupError } from './startup/start-server';
import { writeOpenApi } from './startup/write-openapi';

async function bootstrap(): Promise<void> {
  const openApiFlag = process.argv.indexOf('--write-openapi');
  const openApiFile = openApiFlag >= 0 ? process.argv[openApiFlag + 1] : undefined;

  const app = await startServer({
    env: process.env,
    webRoot: resolve(__dirname, '../web/browser'),
    migrationsFolder: join(__dirname, 'migrations'),
    listen: openApiFile === undefined
  });

  if (openApiFile !== undefined) {
    writeOpenApi(app, openApiFile);
    await app.close();
    process.exit(0);
  }
}

bootstrap().catch((error: unknown) => {
  const logger = createBootstrapLogger();
  if (error instanceof StartupError) {
    logger.fatal({ step: error.step, err: error.cause }, error.message);
  } else {
    logger.fatal({ err: error }, 'Startup failed');
  }
  process.exit(1);
});
