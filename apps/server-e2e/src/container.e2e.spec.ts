import { type GitHttpServer, startGitHttpServer } from '@front-burner/server-core-git/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Container, E2E_IMAGE, startContainer } from './support/container';
import { waitFor } from './support/git-api';
import { createRemotes, type HoldingProxy, pushFileFromElsewhere, startHoldingProxy } from './support/git-remotes';
import { BUILD_VERSION, E2E_ADMIN, E2E_SETUP_TOKEN } from './support/server-process';

/**
 * The release image under NF-11.13's hardening (exit criterion 2): it becomes
 * healthy, works, survives a restart and stops cleanly, and the deployment
 * guide's compose example starts it. Runs only when
 * `E2E_IMAGE` names an image, as the `image` job of CI does after its scan.
 * Needs Docker on Linux, for host networking (`support/container-compose.yaml`),
 * and Docker Compose 2.24.4 or later, for the `!override` tag of
 * `support/example-override.yaml`:
 *
 *   docker build -f tools/docker/Dockerfile -t front-burner:test .
 *   E2E_IMAGE=front-burner:test npx nx run server-e2e:e2e-container
 */

/** A stop that waits for a held clone; Docker's grace period is 30 seconds (NF-9.1). */
const SLOW_MS = 120_000;

interface Answer {
  status: number;
  body: Record<string, unknown>;
}

interface Summary {
  id: number;
  status: string;
  error: string | null;
}

async function call(
  container: Container,
  method: string,
  path: string,
  token?: string,
  body?: unknown
): Promise<Answer> {
  const headers: Record<string, string> = token === undefined ? {} : { authorization: `Bearer ${token}` };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  const response = await fetch(`${container.url}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  return { status: response.status, body: (text === '' ? {} : JSON.parse(text)) as Record<string, unknown> };
}

describe.skipIf(E2E_IMAGE === undefined)('the release image (NF-11.13)', { timeout: SLOW_MS }, () => {
  describe('a hardened instance', () => {
    let root: string;
    let remote: string;
    let git: GitHttpServer;
    let proxy: HoldingProxy | undefined;
    let container: Container;
    let authToken: string;
    let refreshToken: string;

    const recent = async (): Promise<Summary[]> =>
      (await call(container, 'GET', '/api/v1/repositories/recent', authToken)).body['repositories'] as Summary[];
    const statusOf = async (id: number) => (await recent()).find(summary => summary.id === id);
    const add = (name: string, remoteUrl: string) =>
      call(container, 'POST', '/api/v1/repositories', authToken, {
        remoteUrl,
        name,
        credentials: { mode: 'none' },
        cloneMode: 'full'
      });

    beforeAll(async () => {
      root = mkdtempSync(join(tmpdir(), 'front-burner-e2e-container-git-'));
      remote = createRemotes(root).handbook;
      pushFileFromElsewhere(remote, 'README.md', '# Handbook\n');
      git = await startGitHttpServer({ repositories: { 'handbook.git': remote } });
      container = await startContainer();
    }, SLOW_MS);

    afterAll(async () => {
      // Every step runs even when an earlier one fails.
      const results = await Promise.allSettled([
        container?.remove(),
        proxy?.close(),
        git?.close()
      ]);
      rmSync(root, { recursive: true, force: true });
      const failed = results.find(result => result.status === 'rejected');
      if (failed !== undefined) {
        throw failed.reason;
      }
    }, SLOW_MS);

    it('the hardened container becomes healthy', async () => {
      const state = await container.inspect();

      expect(state.State.Health?.Status).toBe('healthy');
      expect(state.Config.User).toBe('1000:1000');
      expect(state.HostConfig.ReadonlyRootfs).toBe(true);
      expect(state.HostConfig.CapDrop).toEqual([ 'ALL' ]);
      expect(state.HostConfig.SecurityOpt).toContain('no-new-privileges:true');
    });

    it('the health endpoints answer without a version', async () => {
      for (const path of [ 'live', 'ready' ]) {
        const response = await fetch(`${container.url}/api/health/${path}`);
        const text = await response.text();

        expect(response.status, path).toBe(200);
        expect(JSON.parse(text), path).toEqual({ status: 'ok' });
        expect(response.headers.get('x-front-burner-version'), path).toBeNull();
        expect(text, path).not.toContain(BUILD_VERSION);
      }
    });

    it('onboarding, login, a clone and a save work', async () => {
      const onboarded = await call(container, 'POST', '/api/v1/onboarding/password-setup', undefined, {
        setupToken: E2E_SETUP_TOKEN,
        ...E2E_ADMIN
      });
      expect(onboarded.status).toBe(204);
      const login = await call(container, 'POST', '/api/v1/auth/login', undefined, {
        email: E2E_ADMIN.email,
        password: E2E_ADMIN.password,
        refreshTokenDelivery: 'body'
      });
      expect(login.status).toBe(200);
      authToken = login.body['authToken'] as string;
      refreshToken = login.body['refreshToken'] as string;

      const added = await add('Handbook', `${git.url}/handbook.git`);
      expect(added.status).toBe(201);
      const id = added.body['id'] as number;
      await waitFor(async () => (await statusOf(id))?.status !== 'cloning');
      expect(await statusOf(id)).toMatchObject({ status: 'ready', error: null });

      const file = `/api/v1/repositories/${id}/file`;
      const saved = await call(container, 'PUT', file, authToken, {
        path: 'README.md',
        content: '# Handbook\n\nSaved in the container.\n',
        lineEnding: 'lf',
        bom: false
      });
      expect(saved.status).toBe(200);
      const read = await call(container, 'GET', `${file}?path=README.md`, authToken);
      expect(read.status).toBe(200);
      expect(read.body['content']).toBe('# Handbook\n\nSaved in the container.\n');
    });

    it('reaps processes left by their parent, such as git\'s detached maintenance', async () => {
      // A process whose parent ends goes to the container's PID 1, which must reap it when it ends: otherwise
      // each fetch, merge and commit leaves a zombie, until the pids limit stops every git (plan 160).
      const zombies = await container.exec(
        'sh',
        '-c',
        '(sleep 0.1 &); sleep 1; grep -h "^State:" /proc/[0-9]*/status | grep -c zombie || true'
      );

      expect(zombies.trim()).toBe('0');
      expect((await container.exec('cat', '/proc/1/comm')).trim()).toBe('tini');
    });

    it('a session survives a restart', async () => {
      await container.restart();

      expect((await call(container, 'GET', '/api/v1/me', authToken)).status).toBe(200);
      const refreshed = await call(container, 'POST', '/api/v1/auth/session/refresh', undefined, { refreshToken });
      expect(refreshed.status).toBe(200);
      authToken = refreshed.body['authToken'] as string;
      const [ handbook ] = await recent();
      const read = await call(container, 'GET', `/api/v1/repositories/${handbook?.id}/file?path=README.md`, authToken);
      expect(read.body['content']).toBe('# Handbook\n\nSaved in the container.\n');
    });

    let heldId: number;

    it('stops within the grace period during a clone', async () => {
      const held = await startHoldingProxy(Number(new URL(git.url).port));
      proxy = held;
      const heldUrl = `https://127.0.0.1:${held.port}/handbook.git`;
      // Hold from the connection after the submit's access check, so that the clone waits (AR-49).
      const before = held.connections;
      const check = await call(container, 'POST', '/api/v1/repositories/access-check', authToken, {
        remoteUrl: heldUrl,
        credentials: { mode: 'none' }
      });
      expect(check.status).toBe(200);
      const clonesConnection = held.connections + (held.connections - before);
      held.holdFrom(clonesConnection);
      const added = await add('Held', heldUrl);
      expect(added.status).toBe(201);
      heldId = added.body['id'] as number;
      await waitFor(() => held.connections > clonesConnection);
      expect(await statusOf(heldId)).toMatchObject({ status: 'cloning' });

      const stopped = await container.stop();

      // Docker kills the backend at 30 seconds; NF-9.2 ends it before.
      expect(stopped.seconds).toBeLessThan(30);
      expect(stopped.exitCode).toBe(0);
      expect(stopped.oomKilled).toBe(false);
    });

    it('the clone interrupted by a stop is failed after the next start', async () => {
      proxy?.release();
      await container.start();

      // NF-9.5: the stop left the clone running; the next start fails it (AR-54).
      expect(await statusOf(heldId)).toMatchObject({ status: 'error', error: 'clone-failed' });
    });
  });

  describe('the deployment guide', () => {
    let container: Container | undefined;

    afterAll(async () => {
      await container?.remove();
    }, SLOW_MS);

    it('the guide\'s compose example becomes healthy', async () => {
      // docs/wiki/compose.example.yaml with only the image, the port and the secret files replaced.
      container = await startContainer({ example: true });

      const { State, Config, HostConfig } = await container.inspect();
      expect(State.Health?.Status).toBe('healthy');
      expect(Config.User).toBe('1000:1000');
      expect(HostConfig.ReadonlyRootfs).toBe(true);
      expect(HostConfig.CapDrop).toEqual([ 'ALL' ]);
      expect(HostConfig.SecurityOpt).toContain('no-new-privileges:true');
      // NF-9.1.
      expect(HostConfig.RestartPolicy.Name).toBe('unless-stopped');
      expect(Config.StopTimeout).toBe(30);
      // The secrets came from their files: the setup token from one is accepted.
      const onboarded = await call(container, 'POST', '/api/v1/onboarding/password-setup', undefined, {
        setupToken: E2E_SETUP_TOKEN,
        ...E2E_ADMIN
      });
      expect(onboarded.status).toBe(204);
    });
  });

  describe('a data volume of another UID', () => {
    let container: Container | undefined;

    afterAll(async () => {
      await container?.remove();
    }, SLOW_MS);

    it('an unwritable /data stops the start and names the UID', async () => {
      container = await startContainer({ dataOwner: 2000, expectFailedStart: true });

      // The backend exits by itself; without a restart policy, the container stays stopped.
      await waitFor(async () => (await container?.inspect())?.State.Status === 'exited');
      const { State } = await container.inspect();
      expect(State.ExitCode).toBe(1);
      expect(State.Health?.Status).not.toBe('healthy');
      // NF-5.6: the log names the path and the UID that the volume must belong to.
      const logs = await container.logs();
      expect(logs).toContain('is not writable by UID 1000');
      expect(logs).toContain('"step":"data-dir"');
      expect(logs).toContain('/data/db');
    });
  });
});
