import BetterSqlite3 from 'better-sqlite3';
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const MAIN = resolve(import.meta.dirname, '../../../../dist/apps/server/main.js');
const TIMEOUT_MS = 10_000;
/** The certificate of the git test servers (`TEST_CERTIFICATE_FILES` of server-core-security's testing). */
const TEST_CERTIFICATE = resolve(
  import.meta.dirname,
  '../../../../libs/server/core/security/src/testing/fixtures/test.crt'
);

/** The `FRONT_BURNER_JWT_SECRET` of every test server unless a test sets its own. */
export const TEST_JWT_SECRET = 'server-e2e-jwt-secret-0123456789abcdefghijklmnop';

/** The `FRONT_BURNER_ENCRYPTION_KEY` of every test server unless a test sets its own. */
export const TEST_ENCRYPTION_KEY = 'server-e2e-encryption-key-0123456789abcdefghijk';

export interface ServerProcess {
  url: string;
  dataDir: string;
  stop(): Promise<void>;
  /** Stops the server with `SIGKILL`, as a crash or a power cut would. */
  kill(): Promise<void>;
  output(): string;
  /**
   * Waits until the output contains `text`. The server logs asynchronously, so
   * a response can arrive before the lines logged while handling it.
   */
  waitForOutput(text: string): Promise<string>;
}

export interface ServerOptions {
  /** Called with the data directory before the server starts. */
  prepare?: (dataDir: string) => void;
  cwd?: string;
  /** A PEM file the server trusts besides the system's authorities (`NODE_EXTRA_CA_CERTS`). */
  extraCaFile?: string;
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
      FRONT_BURNER_JWT_SECRET: TEST_JWT_SECRET,
      FRONT_BURNER_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
      // git trusts the certificate of the git test servers (AR-43: through the container's authorities).
      GIT_SSL_CAINFO: TEST_CERTIFICATE,
      ...(options.extraCaFile === undefined ? {} : { NODE_EXTRA_CA_CERTS: options.extraCaFile }),
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

async function outputContaining(text: string, output: () => string): Promise<string> {
  const deadline = Date.now() + TIMEOUT_MS;
  while (!output().includes(text)) {
    if (Date.now() > deadline) {
      throw new Error(`Waiting for ${JSON.stringify(text)} in the output timed out. Output:\n${output()}`);
    }
    await new Promise(r => setTimeout(r, 20));
  }
  return output();
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
    waitForOutput: text => outputContaining(text, spawned.output),
    kill: async () => {
      polling = false;
      await spawned.cleanup();
    },
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

/** The setup token that {@link onboard} sends; start the server with it as `FRONT_BURNER_SETUP_TOKEN`. */
export const E2E_SETUP_TOKEN = 'e2e-setup-token-0123456789abcdef';

/** The administrator that {@link onboard} creates. */
export const E2E_ADMIN = { email: 'admin@example.com', displayName: 'Admin', password: 'correct horse 1' };

export function postJson(
  server: ServerProcess,
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<Response> {
  return fetch(`${server.url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
}

/** Completes administrator onboarding with {@link E2E_ADMIN}. */
export async function onboard(server: ServerProcess): Promise<void> {
  const response = await postJson(server, '/api/v1/onboarding/password-setup', {
    setupToken: E2E_SETUP_TOKEN,
    ...E2E_ADMIN
  });
  if (response.status !== 204) {
    throw new Error(`Onboarding failed with ${response.status}: ${await response.text()}`);
  }
}

export interface LoggedIn {
  response: Response;
  authToken: string;
  /** From the body or the cookie, depending on the delivery. */
  refreshToken: string;
}

/** The refresh token in a response's `Set-Cookie`, or an empty string. */
export function refreshCookieOf(response: Response): string {
  const cookie = response.headers.getSetCookie().find(value => value.startsWith('front_burner_refresh='));
  return /^front_burner_refresh=([^;]*)/.exec(cookie ?? '')?.[1] ?? '';
}

/** Logs {@link E2E_ADMIN} in, or whoever `credentials` names. */
export async function login(
  server: ServerProcess,
  delivery: 'cookie' | 'body' = 'cookie',
  credentials: { email: string; password: string; } = E2E_ADMIN
): Promise<LoggedIn> {
  const response = await postJson(server, '/api/v1/auth/login', { ...credentials, refreshTokenDelivery: delivery });
  if (response.status !== 200) {
    throw new Error(`Login failed with ${response.status}: ${await response.text()}`);
  }
  const body = (await response.clone().json()) as { authToken: string; refreshToken?: string; };
  return { response, authToken: body.authToken, refreshToken: body.refreshToken ?? refreshCookieOf(response) };
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

export interface SeedUser {
  email: string;
  displayName?: string;
}

export interface SeedRepository {
  userId: number;
  name: string;
  remoteUrl?: string;
  status?: 'cloning' | 'ready' | 'error';
  errorCode?: 'clone-failed' | 'clone-timed-out' | 'working-copy-missing';
  lastAccessedAt: Date;
}

/**
 * Inserts users and repositories into a running server's database, which the
 * server has migrated (WAL lets both write). Every seeded user is a password
 * user with {@link E2E_ADMIN}'s password, so onboard first. Returns the new IDs.
 */
export function seed(
  dataDir: string,
  rows: { users?: SeedUser[]; repositories?: SeedRepository[]; }
): { userIds: number[]; repositoryIds: number[]; } {
  const sqlite = new BetterSqlite3(join(dataDir, 'db', 'front-burner.sqlite'));
  try {
    const { password_hash: passwordHash } = sqlite.prepare('SELECT password_hash FROM users ORDER BY id LIMIT 1')
      .get() as { password_hash: string; };
    const insertUser = sqlite.prepare(
      `INSERT INTO users (email, display_name, role, login_method, password_hash, created_at)
       VALUES (?, ?, 'user', 'password', ?, ?)`
    );
    const insertRepository = sqlite.prepare(
      `INSERT INTO repositories
         (user_id, name, remote_url, clone_mode, git_level, status, error_code, created_at, last_accessed_at)
       VALUES (?, ?, ?, 'full', 'advanced', ?, ?, ?, ?)`
    );
    const userIds = (rows.users ?? []).map(user =>
      Number(insertUser.run(user.email, user.displayName ?? user.email, passwordHash, Date.now()).lastInsertRowid)
    );
    const repositoryIds = (rows.repositories ?? []).map(repository =>
      Number(
        insertRepository.run(
          repository.userId,
          repository.name,
          repository.remoteUrl ?? `https://github.com/acme/${repository.name}.git`,
          repository.status ?? 'ready',
          repository.errorCode ?? null,
          repository.lastAccessedAt.getTime(),
          repository.lastAccessedAt.getTime()
        ).lastInsertRowid
      )
    );
    return { userIds, repositoryIds };
  } finally {
    sqlite.close();
  }
}
