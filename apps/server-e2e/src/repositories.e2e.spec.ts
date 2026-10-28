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

interface Summary {
  id: number;
  name: string;
  remote: string;
  status: string;
  lastAccessedAt: string;
}

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 26, 10, minutes));

describe('recent repositories (REQ-DASH-001)', () => {
  let server: ServerProcess;
  let users = 0;

  beforeAll(async () => {
    server = await startServerProcess({ FRONT_BURNER_SETUP_TOKEN: E2E_SETUP_TOKEN });
    await onboard(server);
  });

  afterAll(async () => {
    await server?.stop();
  });

  /** A new user of its own for each test, so that tests do not see each other's repositories. */
  function newUser(): number {
    users++;
    return seed(server.dataDir, { users: [ { email: `user${users}@example.com` } ] }).userIds[0] as number;
  }

  async function recent(email: string): Promise<Summary[]> {
    const { authToken } = await login(server, 'body', { email, password: E2E_ADMIN.password });
    const response = await fetch(`${server.url}/api/v1/repositories/recent`, {
      headers: { authorization: `Bearer ${authToken}` }
    });
    expect(response.status).toBe(200);
    return ((await response.json()) as { repositories: Summary[]; }).repositories;
  }

  it('AC-DASH-001.5: of 12 repositories, the 10 most recently accessed, most recent first', async () => {
    const userId = newUser();
    seed(server.dataDir, {
      repositories: Array.from({ length: 12 }, (_, i) => ({ userId, name: `repo-${i}`, lastAccessedAt: at(i) }))
    });

    const names = (await recent(`user${users}@example.com`)).map(repository => repository.name);

    expect(names).toEqual([ 11, 10, 9, 8, 7, 6, 5, 4, 3, 2 ].map(i => `repo-${i}`));
  });

  it('AC-DASH-001.5: all 3 of 3 repositories', async () => {
    const userId = newUser();
    seed(server.dataDir, {
      repositories: [ 'a', 'b', 'c' ].map((name, i) => ({ userId, name, lastAccessedAt: at(i) }))
    });

    expect(await recent(`user${users}@example.com`)).toHaveLength(3);
  });

  it('AC-DASH-001.7: the repository with the newest last access time is first', async () => {
    const userId = newUser();
    seed(server.dataDir, {
      repositories: [
        { userId, name: 'old', lastAccessedAt: at(1) },
        { userId, name: 'added', status: 'cloning', lastAccessedAt: at(30) },
        { userId, name: 'older', lastAccessedAt: at(0) }
      ]
    });

    const [ first ] = await recent(`user${users}@example.com`);

    expect(first).toMatchObject({ name: 'added', status: 'cloning', lastAccessedAt: at(30).toISOString() });
  });

  it('AC-DASH-001.8: two users of one remote each have their own last access time', async () => {
    const alice = newUser();
    const aliceEmail = `user${users}@example.com`;
    const bob = newUser();
    const bobEmail = `user${users}@example.com`;
    const remoteUrl = 'https://github.com/acme/shared.git';
    seed(server.dataDir, {
      repositories: [
        { userId: alice, name: 'shared', remoteUrl, lastAccessedAt: at(50) },
        { userId: alice, name: 'mine', lastAccessedAt: at(40) },
        { userId: bob, name: 'shared', remoteUrl, lastAccessedAt: at(10) },
        { userId: bob, name: 'his', lastAccessedAt: at(20) }
      ]
    });

    const aliceList = await recent(aliceEmail);
    const bobList = await recent(bobEmail);

    expect(aliceList.map(repository => repository.name)).toEqual([ 'shared', 'mine' ]);
    expect(bobList.map(repository => repository.name)).toEqual([ 'his', 'shared' ]);
    expect(aliceList[0]?.id).not.toBe(bobList[1]?.id);
  });

  it('AC-DASH-001.9: the administrator and another user see only their own repositories', async () => {
    const userId = newUser();
    const email = `user${users}@example.com`;
    seed(server.dataDir, {
      repositories: [
        { userId: 1, name: 'admin-notes', lastAccessedAt: at(0) },
        { userId, name: 'user-notes', lastAccessedAt: at(0) }
      ]
    });

    expect((await recent(E2E_ADMIN.email)).map(repository => repository.name)).toEqual([ 'admin-notes' ]);
    expect((await recent(email)).map(repository => repository.name)).toEqual([ 'user-notes' ]);
  });

  it('AC-DASH-001.10: the remote as host and path, never with credentials', async () => {
    const userId = newUser();
    seed(server.dataDir, {
      repositories: [
        { userId, name: 'https', remoteUrl: 'https://github.com/acme/handbook.git', lastAccessedAt: at(3) },
        { userId, name: 'ssh', remoteUrl: 'git@github.com:acme/handbook.git', lastAccessedAt: at(2) },
        { userId, name: 'token', remoteUrl: 'https://u:t@github.com/acme/handbook.git', lastAccessedAt: at(1) }
      ]
    });

    const list = await recent(`user${users}@example.com`);

    expect(list.map(repository => repository.remote)).toEqual(Array(3).fill('github.com/acme/handbook'));
    expect(JSON.stringify(list)).not.toContain('u:t');
  });

  it('recent requires a login', async () => {
    const response = await fetch(`${server.url}/api/v1/repositories/recent`);
    expect(response.status).toBe(401);
    expect(((await response.json()) as { code: string; }).code).toBe('unauthenticated');
  });
});
