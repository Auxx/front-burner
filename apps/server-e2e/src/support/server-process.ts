import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const MAIN = resolve(import.meta.dirname, '../../../../dist/apps/server/main.js');
const TIMEOUT_MS = 10_000;

export interface ServerProcess {
  url: string;
  dataDir: string;
  stop(): Promise<void>;
  output(): string;
}

export interface ServerOptions {
  /** Called with the data directory before the server starts. */
  prepare?: (dataDir: string) => void;
  cwd?: string;
}

export async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const { port } = server.address() as { port: number; };
  await new Promise<void>(resolveClose => server.close(() => resolveClose()));
  return port;
}

interface Spawned {
  child: ChildProcess;
  dataDir: string;
  exited: Promise<number | null>;
  output(): string;
  cleanup(): Promise<void>;
}

async function spawnServer(env: Record<string, string>, options: ServerOptions): Promise<Spawned & { port: number; }> {
  // A caller that names the data directory owns it; otherwise it is a temp dir of ours.
  const ownsDataDir = env['FRONT_BURNER_DATA_DIR'] === undefined;
  const dataDir = env['FRONT_BURNER_DATA_DIR'] ?? mkdtempSync(join(tmpdir(), 'front-burner-e2e-'));
  const removeOwnDataDir = () => {
    if (ownsDataDir) {
      rmSync(dataDir, { recursive: true, force: true });
    }
  };
  let port: number;
  try {
    port = await freePort();
    options.prepare?.(dataDir);
  } catch (error) {
    removeOwnDataDir();
    throw error;
  }
  const child = spawn('node', [ MAIN ], {
    cwd: options.cwd ?? process.cwd(),
    env: {
      PATH: process.env['PATH'] ?? '',
      FRONT_BURNER_DATA_DIR: dataDir,
      FRONT_BURNER_PORT: String(port),
      FRONT_BURNER_LOG_FORMAT: 'json',
      ...env
    },
    stdio: [ 'ignore', 'pipe', 'pipe' ]
  });
  let collected = '';
  child.stdout?.on('data', chunk => (collected += chunk));
  child.stderr?.on('data', chunk => (collected += chunk));
  const exited = new Promise<number | null>(resolveExit => {
    child.on('exit', code => resolveExit(code));
    child.on('error', () => resolveExit(null));
  });
  const cleanup = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await exited;
    }
    removeOwnDataDir();
  };
  return { child, dataDir, exited, output: () => collected, cleanup, port };
}

function within<T>(promise: Promise<T>, what: string, output: () => string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out. Output:\n${output()}`)), TIMEOUT_MS);
  });
  return Promise.race([ promise, timeout ]).finally(() => clearTimeout(timer));
}

async function startOnce(env: Record<string, string>, options: ServerOptions): Promise<ServerProcess> {
  const spawned = await spawnServer(env, options);
  const url = `http://127.0.0.1:${spawned.port}`;
  let polling = true;
  const ready = (async () => {
    while (polling) {
      try {
        if ((await fetch(`${url}/api/health/ready`, { signal: AbortSignal.timeout(1000) })).status === 200) {
          return;
        }
      } catch {
        // not listening yet
      }
      await new Promise(r => setTimeout(r, 50));
    }
  })();
  const died = spawned.exited.then(code => {
    throw new Error(`Server exited early with code ${code}. Output:\n${spawned.output()}`);
  });
  try {
    await within(Promise.race([ ready, died ]), 'Waiting for the server', spawned.output);
  } catch (error) {
    polling = false;
    await spawned.cleanup();
    throw error;
  } finally {
    // Nobody waits for the loser of the race.
    died.catch(() => undefined);
  }
  return {
    url,
    dataDir: spawned.dataDir,
    output: spawned.output,
    stop: async () => {
      polling = false;
      if (spawned.child.exitCode === null) {
        spawned.child.kill('SIGTERM');
        try {
          await within(spawned.exited, 'Stopping the server (it ignored SIGTERM)', spawned.output);
        } finally {
          await spawned.cleanup();
        }
      } else {
        await spawned.cleanup();
      }
    }
  };
}

/**
 * Starts the built server on a free port and waits until it is ready. Retries
 * once when the port was taken between `freePort` and the server binding it.
 */
export async function startServerProcess(
  env: Record<string, string> = {},
  options: ServerOptions = {}
): Promise<ServerProcess> {
  try {
    return await startOnce(env, options);
  } catch (error) {
    if (env['FRONT_BURNER_PORT'] === undefined && String((error as Error).message).includes('EADDRINUSE')) {
      return startOnce(env, options);
    }
    throw error;
  }
}

/** Runs the built server until it exits, for startup failures. */
export async function runServerToExit(
  env: Record<string, string>,
  options: ServerOptions = {}
): Promise<{ code: number | null; output: string; dataDir: string; }> {
  const spawned = await spawnServer(env, options);
  try {
    const code = await within(spawned.exited, 'Waiting for the server to exit', spawned.output);
    return { code, output: spawned.output(), dataDir: spawned.dataDir };
  } finally {
    await spawned.cleanup();
  }
}
