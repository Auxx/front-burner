import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  E2E_ADMIN,
  E2E_SETUP_TOKEN,
  login,
  onboard,
  seed,
  type ServerProcess,
  startServerProcess
} from './support/server-process';

describe('git status (REQ-GIT-002)', () => {
  let server: ServerProcess;
  let aliceToken: string;
  let bobToken: string;
  let handbook: number;
  let cloning: number;

  const status = (id: number, token?: string) =>
    fetch(`${server.url}/api/v1/repositories/${id}/git/status`, {
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` }
    });

  beforeAll(async () => {
    server = await startServerProcess({ FRONT_BURNER_SETUP_TOKEN: E2E_SETUP_TOKEN });
    await onboard(server);
    const { userIds: [ aliceId, bobId ] } = seed(server.dataDir, {
      users: [ { email: 'alice@example.com' }, { email: 'bob@example.com' } ]
    });
    const tokenOf = async (email: string) =>
      (await login(server, 'body', { email, password: E2E_ADMIN.password })).authToken;
    aliceToken = await tokenOf('alice@example.com');
    bobToken = await tokenOf('bob@example.com');
    expect(bobId).toBeDefined();
    const seeded = seed(server.dataDir, {
      repositories: [
        { userId: aliceId as number, name: 'handbook', lastAccessedAt: new Date(0) },
        { userId: aliceId as number, name: 'cloning', status: 'cloning', lastAccessedAt: new Date(0) }
      ]
    }).repositoryIds;
    handbook = seeded[0] as number;
    cloning = seeded[1] as number;
    const root = join(server.dataDir, 'repos', String(aliceId), String(handbook));
    mkdirSync(root, { recursive: true });
    execFileSync('git', [ 'init', '-q', '-b', 'main', root ]);
    writeFileSync(join(root, 'README.md'), '# Handbook\n');
  });

  afterAll(async () => {
    await server?.stop();
  });

  it('reports the status of the owner\'s repository', async () => {
    const response = await status(handbook, aliceToken);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      branch: 'main',
      noCommits: true,
      upstream: null,
      ahead: 0,
      behind: 0,
      mergeInProgress: false,
      changes: [ { path: 'README.md', state: 'added' } ]
    });
  });

  it('answers another user like a missing repository', async () => {
    const response = await status(handbook, bobToken);

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'not-found' });
  });

  it('refuses a repository that is not ready', async () => {
    const response = await status(cloning, aliceToken);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'repository-not-openable' });
  });

  it('needs a login', async () => {
    expect((await status(handbook)).status).toBe(401);
  });
});
