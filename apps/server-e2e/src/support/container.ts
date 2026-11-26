import { execFile } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { E2E_SETUP_TOKEN, freePort } from './server-process';

const run = promisify(execFile);

const WORKSPACE = resolve(import.meta.dirname, '../../../..');
const COMPOSE_FILE = resolve(import.meta.dirname, 'container-compose.yaml');
/** Laid over `container-compose.yaml`: a 64 MB `tmpfs` as the repositories volume, for a full disk. */
const TMPFS_REPOS_FILE = resolve(import.meta.dirname, 'container-tmpfs-repos.yaml');
/** The deployment guide's compose example, and what the suite lays over it. */
const EXAMPLE_FILES = [
  resolve(WORKSPACE, 'docs/wiki/compose.example.yaml'),
  resolve(import.meta.dirname, 'example-override.yaml')
];
/** Test-only values for the example's secret files. */
const EXAMPLE_SECRETS: Record<string, string> = {
  'jwt-secret': 'server-e2e-example-jwt-secret-0123456789abcdefghijk',
  'encryption-key': 'server-e2e-example-encryption-key-0123456789abcdefg',
  'setup-token': E2E_SETUP_TOKEN
};
/** The certificate of the git test servers, mounted read-only into the container. */
const TEST_CERTIFICATE = resolve(WORKSPACE, 'libs/server/core/security/src/testing/fixtures/test.crt');
const SERVICE = 'front-burner';
/**
 * The image's health check runs every 2 seconds during its 5-minute start
 * period (Docker Engine 25 or later; every 10 seconds before), so a healthy
 * start is reported within seconds. A start that never gets ready stays
 * `starting` in that time, so it fails this deadline, not as `unhealthy`.
 */
const HEALTHY_WITHIN_MS = 60_000;

/** The image the container suite tests, such as `front-burner:test`; without it the suite is skipped. */
export const E2E_IMAGE = process.env['E2E_IMAGE'];

/** The version `buildUpgradeImage` gives its image. */
export const UPGRADE_TEST_VERSION = '0.0.0-upgrade-test';

export interface ContainerOptions {
  /** Variables besides those of `container-compose.yaml`. */
  env?: Record<string, string>;
  /** Gives the empty `/data` volume to this UID before the first start, as a volume prepared by hand might be. */
  dataOwner?: number;
  /**
   * For a start that must fail: the container is not restarted, and
   * `startContainer` does not wait for it to become healthy. By default it has
   * the guide's `restart: unless-stopped` (NF-9.1) and must become healthy.
   */
  expectFailedStart?: boolean;
  /**
   * Without the guide's restart policy, so that after `kill()` the container
   * stays stopped until the test starts it, as a test may change the volume
   * in between.
   */
  noRestart?: boolean;
  /**
   * A 64 MB `tmpfs` at `/repositories` is the repositories volume
   * (`FRONT_BURNER_REPOS_DIR`), so that a test can fill it. It is lost when
   * the container stops.
   */
  repositoriesTmpfs?: boolean;
  /**
   * Starts the deployment guide's compose example (`docs/wiki/compose.example.yaml`)
   * instead of `container-compose.yaml`, with only the image, the port and the
   * secret files replaced. `env` and `dataOwner` do not apply to it.
   */
  example?: boolean;
}

/** What a one-off container of `Container.run` printed, and how it ended. */
export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface Container {
  /** `http://127.0.0.1:<port>`: the instance, with no HTTPS terminator in front. */
  url: string;
  /** The container's `docker inspect` document. */
  inspect(): Promise<ContainerState>;
  logs(): Promise<string>;
  /** `docker exec`: runs a command in the running container and gives its stdout. */
  exec(...command: string[]): Promise<string>;
  /**
   * `docker compose run --rm` with the service's volumes and hardening, as the
   * deployment guide runs `tar`, `ls` and `cp` for a backup, a restore or going
   * back: whether the instance runs or not. `volumes` are more `-v` mounts. A
   * command that fails does not throw: its exit code is in the result.
   */
  run(command: string[], volumes?: string[]): Promise<RunResult>;
  /** Waits for Docker's own health check (the image's `HEALTHCHECK`) to report healthy. */
  healthy(): Promise<void>;
  /** Waits until the container has exited, and gives its state. */
  exited(): Promise<ContainerState>;
  /** `docker compose restart`, then healthy again. */
  restart(): Promise<void>;
  /** `docker compose start` after a stop, then healthy again. */
  start(): Promise<void>;
  /** `docker compose stop`, with the compose file's grace period: how long it took and how the backend exited. */
  stop(): Promise<{ seconds: number; exitCode: number; oomKilled: boolean; }>;
  /** `docker kill --signal KILL`, as a crash or a power cut would; waits until it has exited. */
  kill(): Promise<void>;
  /**
   * Changes the image in the compose project and runs `docker compose up -d`,
   * as the guide's upgrade and its going back do, on the same volume. Waits
   * for healthy, unless `expectFailedStart`, which also turns the restart
   * policy off.
   */
  useImage(image: string, options?: { expectFailedStart?: boolean; }): Promise<void>;
  /** Removes the container and its volume. */
  remove(): Promise<void>;
}

export interface ContainerState {
  State: { Status: string; ExitCode: number; OOMKilled: boolean; Health?: { Status: string; }; };
  Config: { User: string; StopTimeout?: number; };
  HostConfig: {
    ReadonlyRootfs: boolean;
    CapDrop: string[] | null;
    SecurityOpt: string[] | null;
    RestartPolicy: { Name: string; };
  };
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
  const secrets = join(work, 'secrets');
  mkdirSync(secrets);
  for (const [ name, value ] of Object.entries(EXAMPLE_SECRETS)) {
    // Readable by the container's UID 1000 whoever runs the suite; the guide gives them to UID 1000 instead.
    writeFileSync(join(secrets, name), `${value}\n`, { mode: 0o444 });
  }
  const project = `front-burner-e2e-${port}`;
  const restartPolicy = (expectFailedStart: boolean | undefined) =>
    expectFailedStart === true || options.noRestart === true ? 'no' : 'unless-stopped';
  const composeEnv = {
    ...process.env,
    E2E_IMAGE: image,
    E2E_PORT: String(port),
    E2E_ENV_FILE: envFile,
    E2E_CERTIFICATE: TEST_CERTIFICATE,
    E2E_SECRETS: secrets,
    E2E_RESTART: restartPolicy(options.expectFailedStart)
  };
  const composeFiles = options.example === true
    ? EXAMPLE_FILES
    : [ COMPOSE_FILE, ...(options.repositoriesTmpfs === true ? [ TMPFS_REPOS_FILE ] : []) ];
  const files = composeFiles.flatMap(file => [ '-f', file ]);
  const compose = async (...args: string[]): Promise<string> => {
    const { stdout } = await run('docker', [ 'compose', '-p', project, ...files, ...args ], {
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
  const exited = async (): Promise<ContainerState> => {
    const deadline = Date.now() + HEALTHY_WITHIN_MS;
    for (;;) {
      const state = await inspect();
      if (state.State.Status === 'exited') {
        return state;
      }
      if (Date.now() > deadline) {
        throw new Error(`The container is still ${state.State.Status}. Logs:\n${await logs()}`);
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
    if (options.expectFailedStart !== true) {
      await healthy();
    }
  } catch (error) {
    // The start's error, with the logs that explain it, matters more than a failed cleanup.
    await remove().catch(() => undefined);
    throw error;
  }

  return {
    url: `http://127.0.0.1:${port}`,
    inspect,
    logs,
    exec: async (...command: string[]) => (await run('docker', [ 'exec', await id(), ...command ])).stdout,
    run: async (command: string[], volumes: string[] = []) => {
      const mounts = volumes.flatMap(volume => [ '-v', volume ]);
      try {
        const { stdout, stderr } = await run(
          'docker',
          [ 'compose', '-p', project, ...files, 'run', '--rm', '--no-deps', '-T', ...mounts, SERVICE, ...command ],
          { env: composeEnv, maxBuffer: 64 * 1024 * 1024 }
        );
        return { exitCode: 0, stdout, stderr };
      } catch (error) {
        const failed = error as { code?: unknown; stdout?: string; stderr?: string; };
        if (typeof failed.code !== 'number') {
          throw error;
        }
        return { exitCode: failed.code, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '' };
      }
    },
    healthy,
    exited,
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
    kill: async () => {
      await run('docker', [ 'kill', '--signal', 'KILL', await id() ]);
      await exited();
    },
    useImage: async (next: string, useOptions: { expectFailedStart?: boolean; } = {}) => {
      await compose('stop', SERVICE);
      composeEnv.E2E_IMAGE = next;
      composeEnv.E2E_RESTART = restartPolicy(useOptions.expectFailedStart);
      await compose('up', '-d', '--no-deps', SERVICE);
      if (useOptions.expectFailedStart !== true) {
        await healthy();
      }
    },
    remove
  };
}

/** `docker image rm` of an image a test built, such as `buildUpgradeImage`'s; nothing when there is none. */
export async function removeImage(image: string | undefined): Promise<void> {
  if (image !== undefined) {
    await run('docker', [ 'image', 'rm', '--force', image ]);
  }
}

/** What `Dockerfile.dockerignore` leaves out of the build anyway, and is too large to copy. */
const NOT_COPIED = new Set([ 'node_modules', 'dist', 'tmp', 'coverage', 'out-tsc', '.nx', '.angular', '.git' ]);

/**
 * The image of an upgrade: `baseImage`'s source, the working tree, plus one
 * throwaway migration that creates the table `upgrade_test`, built with the
 * version {@link UPGRADE_TEST_VERSION} (plan 153). The source is copied to a
 * temporary folder, so nothing of it reaches the workspace; the build reuses
 * the builder's layer cache up to the server's build.
 *
 * @returns the new image's tag.
 */
export async function buildUpgradeImage(baseImage: string): Promise<string> {
  // The repository without its tag or digest: a registry's port, before the last `/`, stays.
  const tag = `${baseImage.replace(/(@.*|:[^/]*)$/, '')}:upgrade-test`;
  const copy = mkdtempSync(join(tmpdir(), 'front-burner-e2e-upgrade-source-'));
  try {
    cpSync(WORKSPACE, copy, {
      recursive: true,
      filter: source => {
        const name = basename(source);
        return name !== 'node_modules' && !(relative(WORKSPACE, source) === name && NOT_COPIED.has(name));
      }
    });
    const migrations = join(copy, 'libs/server/core/database/migrations');
    const journalFile = join(migrations, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalFile, 'utf8')) as {
      entries: { idx: number; when: number; tag: string; }[];
    };
    const last = journal.entries[journal.entries.length - 1];
    if (last === undefined) {
      throw new Error('The migrations journal has no entries');
    }
    journal.entries.push({ ...last, idx: last.idx + 1, when: last.when + 1, tag: '9999_upgrade_test' });
    writeFileSync(journalFile, JSON.stringify(journal, null, 2));
    writeFileSync(
      join(migrations, '9999_upgrade_test.sql'),
      'CREATE TABLE `upgrade_test` (`id` integer PRIMARY KEY NOT NULL);'
    );
    try {
      await run('docker', [
        'buildx',
        'build',
        '--load',
        '--progress',
        'plain',
        '-f',
        join(copy, 'tools/docker/Dockerfile'),
        '--build-arg',
        `FRONT_BURNER_VERSION=${UPGRADE_TEST_VERSION}`,
        '-t',
        tag,
        copy
      ], { maxBuffer: 256 * 1024 * 1024 });
    } catch (error) {
      const failed = error as { stderr?: string; };
      throw new Error(`The upgrade image did not build:\n${(failed.stderr ?? '').slice(-20_000)}`);
    }
    return tag;
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}
