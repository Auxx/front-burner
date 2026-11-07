import { mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';

import { expect } from './fixtures';
import { createHandbookRemote } from './git-http-server';
import { type GitSshServer, PROTECTED_KEY, PROTECTED_KEY_PASSPHRASE } from './git-ssh-server';
import { adminAuthToken, confirmCommitAuthor } from './instance';
import { gitIn } from './working-copy';

/** The ID of `TEST_ADMIN`, the administrator that onboarding created. */
export const ADMIN_ID = 1;

/** The working copy of the administrator's repository `id`. */
export function workingCopyOf(dataDir: string, id: number): string {
  return join(dataDir, 'repos', String(ADMIN_ID), String(id));
}

/** Escapes `text` for a regular expression, such as an accessible name that starts with a file name. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
 * Adds a repository of `remoteUrl` over the API as the administrator, as the
 * Add repository page does, and waits for its clone. Returns its ID and
 * working copy.
 */
export async function addOverApi(
  instance: { url: string; dataDir: string; },
  repository: { name: string; remoteUrl: string; credentials: object; },
  authToken?: string
): Promise<{ id: number; dir: string; }> {
  const token = authToken ?? await adminAuthToken(instance.url);
  const added = await api(instance.url, token, 'POST', '/api/v1/repositories', {
    ...repository,
    cloneMode: 'full'
  });
  expect(added.status).toBe(201);
  const id = added.body['id'] as number;
  await expect.poll(async () => {
    const recent = await api(instance.url, token, 'GET', '/api/v1/repositories/recent');
    return (recent.body['repositories'] as { id: number; status: string; }[]).find(found => found.id === id)?.status;
  }).toBe('ready');
  return { id, dir: workingCopyOf(instance.dataDir, id) };
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
  const { id, dir } = await addOverApi(instance, { name, remoteUrl, credentials }, authToken);
  gitIn(dir, 'commit', '-q', '--allow-empty', '-m', 'second');
  return { id, bare };
}
