import { mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';

import { expect } from './fixtures';
import { createHandbookRemote } from './git-http-server';
import { type GitSshServer, PROTECTED_KEY, PROTECTED_KEY_PASSPHRASE } from './git-ssh-server';
import { adminAuthToken, confirmCommitAuthor } from './instance';
import { gitIn } from './working-copy';

/** The administrator that onboarding created. */
const ADMIN_ID = 1;

/** Calls the API as `authToken`; answers the status and the parsed body. */
export async function api(url: string, authToken: string, method: string, path: string, body?: unknown) {
  const response = await fetch(`${url}${path}`, {
    method,
    headers: { authorization: `Bearer ${authToken}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const text = await response.text();
  return { status: response.status, body: (text === '' ? {} : JSON.parse(text)) as Record<string, unknown> };
}

/**
 * A repository of a new remote in `parent` on the SSH server, added with the
 * passphrase-protected key `laptop` (the key's ID is 1), as the Add repository
 * page does, by another session of the admin: the server's host key is
 * trusted, and the key is unlocked there and locked in the browser's. Its
 * working copy has one commit to push.
 */
export async function sshRepository(
  instance: { url: string; dataDir: string; },
  ssh: GitSshServer,
  remotes: Record<string, string>,
  parent: string
): Promise<{ id: number; bare: string; }> {
  await confirmCommitAuthor(instance.url);
  const name = basename(parent);
  mkdirSync(parent, { recursive: true });
  const bare = createHandbookRemote(parent);
  remotes[`${name}.git`] = bare;
  const remoteUrl = ssh.url(`${name}.git`);
  const credentials = {
    mode: 'new-ssh-key',
    name: 'laptop',
    privateKey: PROTECTED_KEY,
    passphrase: PROTECTED_KEY_PASSPHRASE
  };
  const authToken = await adminAuthToken(instance.url);
  const check = await api(instance.url, authToken, 'POST', '/api/v1/repositories/access-check', {
    remoteUrl,
    credentials
  });
  expect(check.status).toBe(409);
  const { host, port, type, key } = check.body['params'] as Record<string, unknown>;
  expect((await api(instance.url, authToken, 'POST', '/api/v1/known-hosts', { host, port, type, key })).status)
    .toBe(204);
  const added = await api(instance.url, authToken, 'POST', '/api/v1/repositories', {
    remoteUrl,
    name,
    cloneMode: 'full',
    credentials
  });
  expect(added.status).toBe(201);
  const id = added.body['id'] as number;
  await expect.poll(async () => {
    const recent = await api(instance.url, authToken, 'GET', '/api/v1/repositories/recent');
    return (recent.body['repositories'] as { id: number; status: string; }[]).find(found => found.id === id)?.status;
  }).toBe('ready');
  gitIn(join(instance.dataDir, 'repos', String(ADMIN_ID), String(id)), 'commit', '-q', '--allow-empty', '-m', 'second');
  return { id, bare };
}
