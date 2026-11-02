import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  E2E_ADMIN,
  E2E_SETUP_TOKEN,
  login,
  onboard,
  postJson,
  seed,
  type ServerProcess,
  startServerProcess
} from './support/server-process';

describe('preferences API (REQ-GIT-001)', () => {
  let server: ServerProcess;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'front-burner-e2e-preferences-'));
    server = await startServerProcess({ FRONT_BURNER_SETUP_TOKEN: E2E_SETUP_TOKEN, FRONT_BURNER_DATA_DIR: dataDir });
    await onboard(server);
  });

  afterAll(async () => {
    await server?.stop();
    rmSync(dataDir, { recursive: true, force: true });
  });

  const authorized = (authToken: string) => ({
    authorization: `Bearer ${authToken}`,
    'content-type': 'application/json'
  });

  it('manages default commit author preferences and confirmations', async () => {
    const { authToken } = await login(server, 'body');

    // 1. Initial default preference from onboarding
    const getRes = await fetch(`${server.url}/api/v1/preferences/commit-author`, {
      headers: authorized(authToken)
    });
    expect(getRes.status).toBe(200);
    const initialPref = await getRes.json();
    expect(initialPref).toEqual({
      author: {
        name: E2E_ADMIN.displayName,
        email: E2E_ADMIN.email
      },
      confirmed: false
    });

    // 2. Confirm without change
    const confirmRes = await fetch(`${server.url}/api/v1/preferences/commit-author/confirm`, {
      method: 'POST',
      headers: authorized(authToken)
    });
    expect(confirmRes.status).toBe(204);

    const afterConfirmRes = await fetch(`${server.url}/api/v1/preferences/commit-author`, {
      headers: authorized(authToken)
    });
    expect(afterConfirmRes.status).toBe(200);
    expect(((await afterConfirmRes.json()) as { confirmed: boolean; }).confirmed).toBe(true);

    // 3. Update default author
    const putRes = await fetch(`${server.url}/api/v1/preferences/commit-author`, {
      method: 'PUT',
      headers: authorized(authToken),
      body: JSON.stringify({
        name: 'Admin Updated',
        email: 'admin.updated@example.com'
      })
    });
    expect(putRes.status).toBe(200);
    expect(await putRes.json()).toEqual({
      author: {
        name: 'Admin Updated',
        email: 'admin.updated@example.com'
      },
      confirmed: true
    });
  });

  it('manages repository author overrides and fallback', async () => {
    const [ bobId ] = seed(dataDir, { users: [ { email: 'bob@example.com' } ] }).userIds;
    const { repositoryIds } = seed(dataDir, {
      repositories: [
        {
          userId: 1,
          name: 'admin-repo',
          remoteUrl: 'https://github.com/acme/admin-repo.git',
          lastAccessedAt: new Date()
        },
        {
          userId: bobId as number,
          name: 'bob-repo',
          remoteUrl: 'https://github.com/acme/bob-repo.git',
          lastAccessedAt: new Date()
        }
      ]
    });
    const adminRepoId = repositoryIds[0];
    const bobRepoId = repositoryIds[1];

    const { authToken: adminToken } = await login(server, 'body');
    const { authToken: bobToken } = await login(server, 'body', {
      email: 'bob@example.com',
      password: E2E_ADMIN.password
    });

    // 1. Admin reads own repo author -> default
    const repoPrefRes = await fetch(`${server.url}/api/v1/repositories/${adminRepoId}/commit-author`, {
      headers: authorized(adminToken)
    });
    expect(repoPrefRes.status).toBe(200);
    expect(((await repoPrefRes.json()) as { source: string; }).source).toBe('default');

    // 2. Admin sets override on own repo
    const overrideRes = await fetch(`${server.url}/api/v1/repositories/${adminRepoId}/commit-author`, {
      method: 'PUT',
      headers: authorized(adminToken),
      body: JSON.stringify({
        name: 'Admin Override',
        email: 'override@example.com'
      })
    });
    expect(overrideRes.status).toBe(200);
    expect(await overrideRes.json()).toEqual({
      author: {
        name: 'Admin Override',
        email: 'override@example.com'
      },
      source: 'override',
      confirmed: true
    });

    // 3. Admin clears override
    const deleteRes = await fetch(`${server.url}/api/v1/repositories/${adminRepoId}/commit-author`, {
      method: 'DELETE',
      headers: authorized(adminToken)
    });
    expect(deleteRes.status).toBe(200);
    expect(((await deleteRes.json()) as { source: string; }).source).toBe('default');

    // 4. Isolation: Admin cannot access Bob's repo commit author
    const crossRes = await fetch(`${server.url}/api/v1/repositories/${bobRepoId}/commit-author`, {
      headers: authorized(adminToken)
    });
    expect(crossRes.status).toBe(404);

    const crossPut = await fetch(`${server.url}/api/v1/repositories/${bobRepoId}/commit-author`, {
      method: 'PUT',
      headers: authorized(adminToken),
      body: JSON.stringify({ name: 'Hacker', email: 'hack@example.com' })
    });
    expect(crossPut.status).toBe(404);

    const crossDelete = await fetch(`${server.url}/api/v1/repositories/${bobRepoId}/commit-author`, {
      method: 'DELETE',
      headers: authorized(adminToken)
    });
    expect(crossDelete.status).toBe(404);
  });
});
