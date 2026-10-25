import { join, resolve } from 'node:path';
import { parseOpenApiFile } from './startup/cli';
import { logStartupFailure, startServer } from './startup/start-server';
import { writeOpenApi } from './startup/write-openapi';

async function bootstrap(): Promise<void> {
  const openApiFile = parseOpenApiFile(process.argv);

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
  logStartupFailure(error, process.env);
  process.exit(1);
});
