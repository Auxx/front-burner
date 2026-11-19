import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { freePort } from './server-process';

const run = promisify(execFile);

const COMPOSE_FILE = resolve(import.meta.dirname, 'container-compose.yaml');
/** The certificate of the git test servers, mounted read-only into the container. */
const TEST_CERTIFICATE = resolve(
  import.meta.dirname,
  '../../../../libs/server/core/security/src/testing/fixtures/test.crt'
);
const SERVICE = 'front-burner';
/** Docker's health check runs every 10 seconds; a healthy start takes one or two. */
const HEALTHY_WITHIN_MS = 60_000;

/** The image the container suite tests, such as `front-burner:test`; without it the suite is skipped. */
export const E2E_IMAGE = process.env['E2E_IMAGE'];

export interface ContainerOptions {
  /** Variables besides those of `container-compose.yaml`. */
  env?: Record<string, string>;
  /** Gives the empty `/data` volume to this UID before the first start, as a volume prepared by hand might be. */
  dataOwner?: number;
  /** Waits for Docker's health check to report healthy (the default), or only starts the container. */
  waitUntilHealthy?: boolean;
}

export interface Container {
  /** `http://127.0.0.1:<port>`: the instance, with no HTTPS terminator in front. */
  url: string;
  /** The container's `docker inspect` document. */
  inspect(): Promise<ContainerState>;
  logs(): Promise<string>;
  /** Waits until the logs contain `text`. */
  waitForLogs(text: string, ms?: number): Promise<string>;
  /** Waits for Docker's own health check (the image's `HEALTHCHECK`) to report healthy. */
  healthy(): Promise<void>;
  /** `docker compose restart`, then healthy again. */
  restart(): Promise<void>;
  /** `docker compose start` after a stop, then healthy again. */
  start(): Promise<void>;
  /** `docker compose stop`, with the compose file's grace period: how long it took and how the backend exited. */
  stop(): Promise<{ seconds: number; exitCode: number; oomKilled: boolean; }>;
  /** Removes the container and its volume. */
  remove(): Promise<void>;
}

export interface ContainerState {
  State: { Status: string; ExitCode: number; OOMKilled: boolean; Health?: { Status: string; }; };
  Config: { User: string; };
  HostConfig: { ReadonlyRootfs: boolean; CapDrop: string[] | null; SecurityOpt: string[] | null; };
}

/**
 * Starts the image named by `E2E_IMAGE` with `docker compose`, as a project of
 * its own, and waits until Docker reports it healthy.
 */
export async function startContainer(options: ContainerOptions = {}): Promise<Container> {
  if (E2E_IMAGE === undefined) {
    throw new Error('E2E_IMAGE names no image');
  }
  const image = E2E_IMAGE;
  const port = await freePort();
  const work = mkdtempSync(join(tmpdir(), 'front-burner-e2e-container-'));
  const envFile = join(work, 'container.env');
  writeFileSync(
    envFile,
    Object.entries(options.env ?? {}).map(([ name, value ]) => `${name}=${value}\n`).join('')
  );
  const project = `front-burner-e2e-${port}`;
  const composeEnv = {
    ...process.env,
    E2E_IMAGE: image,
    E2E_PORT: String(port),
    E2E_ENV_FILE: envFile,
    E2E_CERTIFICATE: TEST_CERTIFICATE
  };
  const compose = async (...args: string[]): Promise<string> => {
    const { stdout } = await run('docker', [ 'compose', '-p', project, '-f', COMPOSE_FILE, ...args ], {
      env: composeEnv,
      maxBuffer: 64 * 1024 * 1024
    });
    return stdout;
  };
  const id = async (): Promise<string> => (await compose('ps', '-a', '-q', SERVICE)).trim();
  const inspect = async (): Promise<ContainerState> => {
    const { stdout } = await run('docker', [ 'inspect', await id() ]);
    return (JSON.parse(stdout) as ContainerState[])[0] as ContainerState;
  };
  const logs = () => compose('logs', '--no-color', '--no-log-prefix', SERVICE);
  const waitForLogs = async (text: string, ms = HEALTHY_WITHIN_MS): Promise<string> => {
    const deadline = Date.now() + ms;
    for (;;) {
      const output = await logs();
      if (output.includes(text)) {
        return output;
      }
      if (Date.now() > deadline) {
        throw new Error(`Waiting for ${JSON.stringify(text)} in the logs timed out. Logs:\n${output}`);
      }
      await new Promise(r => setTimeout(r, 250));
    }
  };
  const healthy = async (): Promise<void> => {
    const deadline = Date.now() + HEALTHY_WITHIN_MS;
    for (;;) {
      const state = (await inspect()).State;
      if (state.Health?.Status === 'healthy') {
        return;
      }
      if (Date.now() > deadline || state.Health?.Status === 'unhealthy') {
        throw new Error(`The container is ${state.Health?.Status ?? state.Status}. Logs:\n${await logs()}`);
      }
      await new Promise(r => setTimeout(r, 250));
    }
  };
  const remove = async (): Promise<void> => {
    try {
      await compose('down', '--volumes', '--timeout', '0');
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  };

  try {
    await compose('create');
    if (options.dataOwner !== undefined) {
      // Root in a throwaway container may chown; the hardened one may not.
      await run('docker', [
        'run',
        '--rm',
        '--user',
        '0:0',
        '--entrypoint',
        'chown',
        '-v',
        `${project}_data:/data`,
        image,
        `${options.dataOwner}:${options.dataOwner}`,
        '/data'
      ]);
    }
    await compose('start');
    if (options.waitUntilHealthy !== false) {
      await healthy();
    }
  } catch (error) {
    await remove();
    throw error;
  }

  return {
    url: `http://127.0.0.1:${port}`,
    inspect,
    logs,
    waitForLogs,
    healthy,
    restart: async () => {
      await compose('restart', SERVICE);
      await healthy();
    },
    start: async () => {
      await compose('start', SERVICE);
      await healthy();
    },
    stop: async () => {
      const started = Date.now();
      await compose('stop', SERVICE);
      const seconds = (Date.now() - started) / 1000;
      const { State } = await inspect();
      return { seconds, exitCode: State.ExitCode, oomKilled: State.OOMKilled };
    },
    remove
  };
}
