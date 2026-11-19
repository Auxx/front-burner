import { join, resolve } from 'node:path';
import { Command, parseCommand, USAGE } from './startup/cli';
import { resetPassword } from './startup/reset-password';
import { logStartupFailure, startServer } from './startup/start-server';
import { writeOpenApi } from './startup/write-openapi';

/** The root `package.json`'s `version`, replaced by the build (`webpack.config.js`). */
declare const FRONT_BURNER_VERSION: string;

const migrationsFolder = join(__dirname, 'migrations');

async function serve(openApiFile?: string): Promise<void> {
  const app = await startServer({
    env: process.env,
    webRoot: resolve(__dirname, '../web/browser'),
    migrationsFolder,
    gitHelpersDir: join(__dirname, 'git-helpers'),
    listen: openApiFile === undefined,
    version: FRONT_BURNER_VERSION
  });

  if (openApiFile !== undefined) {
    writeOpenApi(app, openApiFile);
    await app.close();
    process.exit(0);
  }
}

async function run(command: Command): Promise<void> {
  switch (command.kind) {
    case 'help':
      process.stdout.write(USAGE);
      process.exit(0);
      break;
    case 'reset-password':
      process.exit(
        await resetPassword({
          env: process.env,
          email: command.email,
          input: process.stdin,
          output: process.stderr,
          migrationsFolder,
          version: FRONT_BURNER_VERSION
        })
      );
      break;
    case 'write-openapi':
      await serve(command.file);
      break;
    case 'serve':
      await serve();
      break;
  }
}

let command: Command;
try {
  command = parseCommand(process.argv);
} catch (error) {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exit(1);
}

run(command).catch((error: unknown) => {
  logStartupFailure(error, process.env);
  process.exit(1);
});
