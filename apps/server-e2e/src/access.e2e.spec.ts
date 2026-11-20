import { readFileSync } from 'node:fs';
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

/**
 * A-7.2, A-7.4 and A-7.5 for every route of the API. The routes come from the
 * OpenAPI document, which CI keeps equal to the code, and `@Public()` and
 * `@AdminOnly()` mark their routes in it (`x-front-burner-access`). So a new
 * route is checked without being listed here, and a new public route, or a
 * route with an ID that this test cannot call, fails it until someone looks.
 * The push channel and the metrics are left out of the document; they take
 * no ID in their path (security review, plan 145).
 */

interface Operation {
  method: string;
  path: string;
  access: 'public' | 'admin' | 'user';
}

const OPENAPI = join(__dirname, '..', '..', 'server', 'openapi.json');

function operations(): Operation[] {
  const document = JSON.parse(readFileSync(OPENAPI, 'utf8')) as {
    paths: Record<string, Record<string, Record<string, unknown>>>;
  };
  return Object.entries(document.paths).flatMap(([ path, methods ]) =>
    Object.entries(methods).map(([ method, operation ]) => ({
      method: method.toUpperCase(),
      path,
      access: (operation['x-front-burner-access'] as 'public' | 'admin' | undefined) ?? 'user'
    }))
  );
}

const key = ({ method, path }: { method: string; path: string; }) => `${method} ${path}`;

/**
 * The routes that work without a login (A-7.2). A route added here is a
 * decision: it must check who is calling in some other way, or need nobody.
 */
const PUBLIC_ROUTES = [
  'GET /api/health/live',
  'GET /api/health/ready',
  'GET /api/v1/auth/methods',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/session/refresh',
  'POST /api/v1/auth/session/logout',
  'GET /api/v1/auth/oidc/start',
  'GET /api/v1/auth/oidc/callback',
  'POST /api/v1/auth/oidc/exchange',
  'GET /api/v1/onboarding',
  'POST /api/v1/onboarding/setup-token/check',
  'POST /api/v1/onboarding/password-setup',
  'POST /api/v1/onboarding/oidc-setup',
  'POST /api/v1/onboarding/oidc-setup/current'
];

const SAVE = { path: 'README.md', content: 'x', lineEnding: 'lf', bom: false };

/**
 * What a route with an ID needs besides it to pass validation, which runs
 * before the handler looks the ID up: a query, a body, or both. A route that
 * needs neither is not listed.
 */
const REQUESTS: Record<string, { query?: string; body?: unknown; }> = {
  'POST /api/v1/credentials/ssh-keys/{id}/unlock': { body: { passphrase: 'guess' } },
  'DELETE /api/v1/repositories/{id}': { query: 'confirmName=secret' },
  'PUT /api/v1/repositories/{id}/credentials': { body: { mode: 'none' } },
  'PUT /api/v1/repositories/{id}/credentials/token': { body: { username: 'mallory', password: 'stolen-token' } },
  'PUT /api/v1/repositories/{id}/commit-author': { body: { name: 'Mallory', email: 'mallory@example.com' } },
  'POST /api/v1/repositories/{id}/entries': { body: { folder: '', name: 'a.md', kind: 'file' } },
  'DELETE /api/v1/repositories/{id}/entries': { query: 'path=README.md' },
  'POST /api/v1/repositories/{id}/entries/rename': { body: { path: 'README.md', name: 'b.md' } },
  'GET /api/v1/repositories/{id}/entries/summary': { query: 'path=README.md' },
  'GET /api/v1/repositories/{id}/entries/ignored': { query: 'path=README.md&kind=file' },
  'GET /api/v1/repositories/{id}/file': { query: 'path=README.md' },
  'PUT /api/v1/repositories/{id}/file': { body: SAVE },
  'GET /api/v1/repositories/{id}/file/state': { query: 'path=README.md' },
  'POST /api/v1/repositories/{id}/file/recreate': { body: SAVE },
  'GET /api/v1/repositories/{id}/image': { query: 'path=logo.png' },
  'POST /api/v1/repositories/{id}/git/branches': { body: { name: 'stolen' } },
  'POST /api/v1/repositories/{id}/git/switch': { body: { name: 'main', remote: false } },
  'GET /api/v1/repositories/{id}/git/merge/version': { query: 'path=README.md&side=theirs' },
  'POST /api/v1/repositories/{id}/git/merge/resolve': { body: { path: 'README.md', resolution: 'ours' } },
  'POST /api/v1/repositories/{id}/git/merge/start-over': { body: { path: 'README.md' } },
  'POST /api/v1/repositories/{id}/git/merge/commit': { body: { message: 'Stolen' } },
  'GET /api/v1/repositories/{id}/git/diff': { query: 'path=README.md' },
  'POST /api/v1/repositories/{id}/git/discard': { body: { paths: [ 'README.md' ] } },
  'POST /api/v1/repositories/{id}/git/commits': { body: { message: 'Stolen', paths: [ 'README.md' ] } }
};

describe('access to every route (A-7.2, A-7.4, A-7.5)', () => {
  let server: ServerProcess;
  let owner: string;
  let intruder: string;
  let repositoryId: number;
  let credentialId: number;

  beforeAll(async () => {
    server = await startServerProcess({ FRONT_BURNER_SETUP_TOKEN: E2E_SETUP_TOKEN });
    await onboard(server);
    // Both plain users: an administrator's own routes are A-7.4's, not ownership's.
    const [ ownerId ] = seed(server.dataDir, {
      users: [ { email: 'owner@example.com' }, { email: 'intruder@example.com' } ]
    }).userIds as [ number ];
    [ repositoryId ] = seed(server.dataDir, {
      repositories: [ { userId: ownerId, name: 'secret', lastAccessedAt: new Date() } ]
    })
      .repositoryIds as [ number ];
    owner = (await login(server, 'body', { email: 'owner@example.com', password: E2E_ADMIN.password })).authToken;
    intruder = (await login(server, 'body', { email: 'intruder@example.com', password: E2E_ADMIN.password }))
      .authToken;
    const generated = await postJson(server, '/api/v1/credentials/ssh-keys/generate', { name: 'Owner\'s key' }, {
      authorization: `Bearer ${owner}`
    });
    expect(generated.status).toBe(201);
    credentialId = ((await generated.json()) as { key: { id: number; }; }).key.id;
  });

  afterAll(async () => {
    await server?.stop();
  });

  const call = async (method: string, path: string, authToken: string, body?: unknown) => {
    const response = await fetch(`${server.url}${path}`, {
      method,
      headers: { authorization: `Bearer ${authToken}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Not JSON: compared as text.
    }
    if (typeof parsed === 'object' && parsed !== null) {
      parsed = { ...parsed, requestId: undefined };
    }
    return { status: response.status, body: parsed };
  };

  it('A-7.2: only the routes meant to be public are', () => {
    expect(operations().filter(operation => operation.access === 'public').map(key).sort())
      .toEqual([ ...PUBLIC_ROUTES ].sort());
  });

  it('A-7.4: every administrator route refuses a user who is not one', async () => {
    const admin = operations().filter(operation => operation.access === 'admin');
    expect(admin.length).toBeGreaterThan(0);
    // Every route under /admin/ is an administrator route.
    expect(
      operations().filter(operation => operation.path.startsWith('/api/v1/admin/') && operation.access !== 'admin')
    )
      .toEqual([]);
    for (const operation of admin) {
      // The guard runs before validation and before any ID is looked up: no body or real ID is needed.
      const answer = await call(operation.method, operation.path.replaceAll(/\{[^}]+\}/g, '1'), intruder);
      expect(answer, key(operation)).toMatchObject({ status: 403, body: { code: 'forbidden' } });
    }
  });

  it('A-7.5: every route with an ID answers another user\'s ID like a missing one', async () => {
    const withId = operations().filter(operation => operation.access === 'user' && operation.path.includes('{id}'));
    expect(withId.length).toBeGreaterThan(0);
    // A listed route that no longer exists is a stale entry.
    expect(Object.keys(REQUESTS).filter(listed => !withId.some(operation => key(operation) === listed))).toEqual([]);

    for (const operation of withId) {
      const { query, body } = REQUESTS[key(operation)] ?? {};
      const theirs = operation.path.startsWith('/api/v1/credentials/') ? credentialId : repositoryId;
      // Other parameters, such as a job's ID, get any value: the ID in front of them is refused first.
      const pathOf = (id: number) =>
        `${operation.path.replace('{id}', String(id)).replaceAll(/\{[^}]+\}/g, '1')}${
          query === undefined ? '' : `?${query}`
        }`;

      const other = await call(operation.method, pathOf(theirs), intruder, body);
      const missing = await call(operation.method, pathOf(theirs + 1000), intruder, body);

      // A 400 here means the route needs a query or body in REQUESTS.
      expect(other, key(operation)).toMatchObject({ status: 404, body: { code: 'not-found' } });
      expect(other, key(operation)).toEqual(missing);
    }

    // Nothing of the owner's changed: the repository and the key are still there.
    expect((await call('GET', `/api/v1/repositories/${repositoryId}`, owner)).status).toBe(200);
    const listed = await call('GET', '/api/v1/credentials', owner);
    expect((listed.body as { sshKeys: { id: number; }[]; }).sshKeys.map(saved => saved.id)).toEqual([ credentialId ]);
  });
});
