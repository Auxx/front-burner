import { workspaceRoot } from '@nx/devkit';
import type { Page } from '@playwright/test';
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const READY_TIMEOUT_MS = 15_000;

/** A setup token for tests: 32 characters. */
export const TEST_TOKEN = 'web-e2e-setup-token-0123456789ab';

/** The `FRONT_BURNER_JWT_SECRET` of every instance. */
const TEST_JWT_SECRET = 'web-e2e-jwt-secret-0123456789abcdefghijklmnopqr';

/** The `FRONT_BURNER_ENCRYPTION_KEY` of every instance. */
const TEST_ENCRYPTION_KEY = 'web-e2e-encryption-key-0123456789abcdefghijklmn';

/** The administrator that `onboarded` instances are created with. */
export const TEST_ADMIN = { email: 'admin@example.com', displayName: 'Admin', password: 'correct horse 1' };

export interface InstanceOptions {
  /** `FRONT_BURNER_SETUP_TOKEN`; none when left out. */
  setupToken?: string;
  /** Completes onboarding through the API before the test. */
  onboarded?: boolean;
  /** More `FRONT_BURNER_*` variables, such as `FRONT_BURNER_AUTH_TOKEN_TTL`. */
  env?: Record<string, string>;
  /** OIDC from the environment (AO-30), with `adminEmail` as `FRONT_BURNER_ADMIN_EMAIL`. */
  oidc?: { issuer: string; adminEmail: string; };
  /** A PEM file the server trusts besides the system's authorities (`NODE_EXTRA_CA_CERTS`). */
  extraCaFile?: string;
}

export interface Instance {
  url: string;
  stop(): Promise<void>;
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as { port: number; };
  await new Promise<void>(done => server.close(() => done()));
  return port;
}

async function waitUntilReady(url: string, child: ChildProcess, output: () => string): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`The server exited with code ${child.exitCode}:\n${output()}`);
    }
    try {
      if ((await fetch(`${url}/api/health/ready`)).ok) {
        return;
      }
    } catch {
      // not listening yet
    }
    await new Promise(done => setTimeout(done, 50));
  }
  throw new Error(`The server was not ready after ${READY_TIMEOUT_MS} ms:\n${output()}`);
}

async function onboard(url: string): Promise<void> {
  const response = await fetch(`${url}/api/v1/onboarding/password-setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ setupToken: TEST_TOKEN, ...TEST_ADMIN })
  });
  if (response.status !== 204) {
    throw new Error(`Onboarding answered ${response.status}: ${await response.text()}`);
  }
}

/**
 * Starts the built server, serving the built web client, on a free port with
 * an empty data directory: the production path. Every test gets its own,
 * because a completed onboarding cannot be undone.
 */
export async function startInstance(options: InstanceOptions = {}): Promise<Instance> {
  const dataDir = mkdtempSync(join(tmpdir(), 'front-burner-web-e2e-'));
  const port = await freePort();
  const url = `http://localhost:${port}`;
  // Drop the developer's own FRONT_BURNER_* variables.
  const env = Object.fromEntries(Object.entries(process.env).filter(([ key ]) => !key.startsWith('FRONT_BURNER_')));
  const setupToken = options.setupToken ?? (options.onboarded ? TEST_TOKEN : undefined);
  const child = spawn('node', [ 'dist/apps/server/main.js' ], {
    cwd: workspaceRoot,
    env: {
      ...env,
      FRONT_BURNER_PORT: String(port),
      FRONT_BURNER_DATA_DIR: dataDir,
      FRONT_BURNER_LOG_FORMAT: 'json',
      FRONT_BURNER_LOG_LEVEL: 'warn',
      FRONT_BURNER_JWT_SECRET: TEST_JWT_SECRET,
      FRONT_BURNER_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
      ...(setupToken ? { FRONT_BURNER_SETUP_TOKEN: setupToken } : {}),
      ...(options.oidc
        ? {
          FRONT_BURNER_OIDC_ISSUER: options.oidc.issuer,
          FRONT_BURNER_OIDC_CLIENT_ID: 'web-e2e',
          FRONT_BURNER_OIDC_CLIENT_SECRET: 'web-e2e-client-secret',
          FRONT_BURNER_ADMIN_EMAIL: options.oidc.adminEmail
        }
        : {}),
      ...(options.extraCaFile ? { NODE_EXTRA_CA_CERTS: options.extraCaFile } : {}),
      ...options.env
    },
    stdio: [ 'ignore', 'pipe', 'pipe' ]
  });
  let output = '';
  child.stdout?.on('data', chunk => (output += chunk));
  child.stderr?.on('data', chunk => (output += chunk));
  const exited = new Promise<void>(done => child.on('exit', () => done()));

  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await exited;
    }
    rmSync(dataDir, { recursive: true, force: true });
  };

  try {
    await waitUntilReady(url, child, () => output);
    if (options.onboarded) {
      await onboard(url);
    }
  } catch (error) {
    await stop();
    throw error;
  }
  return { url, stop };
}

/** Logs in as `TEST_ADMIN` on the login page, which `page` must show, and waits for the page after it. */
export async function logIn(page: Page, email = TEST_ADMIN.email): Promise<void> {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(TEST_ADMIN.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL(url => url.pathname !== '/login');
}
