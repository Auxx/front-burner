// Starts the built server for the e2e run. Runs once per `playwright test`
// (as the webServer command), unlike the config, which every worker loads.
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

const [port, dataDir] = [process.argv[2], join(process.cwd(), 'tmp', 'web-e2e-data')];

// Start from an empty data directory.
rmSync(dataDir, { recursive: true, force: true });

// Drop the developer's own FRONT_BURNER_* variables.
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('FRONT_BURNER_'))
);
const server = spawn('node', ['dist/apps/server/main.js'], {
  stdio: 'inherit',
  env: {
    ...env,
    FRONT_BURNER_PORT: port,
    FRONT_BURNER_DATA_DIR: dataDir,
    FRONT_BURNER_LOG_FORMAT: 'json'
  }
});
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => server.kill(signal));
}
server.on('exit', (code) => process.exit(code ?? 1));
