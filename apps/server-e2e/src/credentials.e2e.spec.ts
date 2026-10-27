import { SecretBox } from '@front-burner/server-core-crypto';
import { FIXTURE_PASSPHRASE, sshKeyFixture } from '@front-burner/server-core-git/testing';
import BetterSqlite3 from 'better-sqlite3';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { utils } from 'ssh2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  E2E_ADMIN,
  E2E_SETUP_TOKEN,
  login,
  onboard,
  postJson,
  seed,
  type ServerProcess,
  startServerProcess,
  TEST_ENCRYPTION_KEY
} from './support/server-process';

interface SavedSshKey {
  id: number;
  name: string;
  unlocked: boolean;
  generated: boolean;
}

const PROTECTED = sshKeyFixture('ed25519-passphrase');
const databaseFile = (dataDir: string) => join(dataDir, 'db', 'front-burner.sqlite');

/**
 * Inserts a passphrase-protected key as plan 11's add endpoint will: the text
 * as pasted, encrypted with the instance key and the row's binding (NF-8.3).
 */
function seedProtectedKey(dataDir: string, userId: number, name: string): number {
  const sqlite = new BetterSqlite3(databaseFile(dataDir));
  try {
    const id = Number(
      sqlite.prepare(
        `INSERT INTO saved_credentials
           (user_id, kind, name, ssh_key_type, ssh_public_key, ssh_fingerprint,
            ssh_passphrase_protected, ssh_generated, created_at)
         VALUES (?, 'ssh-key', ?, 'ed25519', ?, 'SHA256:seeded', 1, 0, ?)`
      ).run(userId, name, sshKeyFixture('ed25519-passphrase.pub').trim(), Date.now()).lastInsertRowid
    );
    const secret = new SecretBox(TEST_ENCRYPTION_KEY).encrypt(PROTECTED, {
      table: 'saved_credentials',
      recordId: id,
      userId
    });
    sqlite.prepare('UPDATE saved_credentials SET secret = ? WHERE id = ?').run(secret, id);
    return id;
  } finally {
    sqlite.close();
  }
}

/** A distinctive part of the decrypted private key, as the backend holds it in memory. */
function decryptedKeyBody(): string {
  const parsed = utils.parseKey(PROTECTED, FIXTURE_PASSPHRASE);
  const key = Array.isArray(parsed) ? parsed[0] : parsed;
  if (key === undefined || key instanceof Error) {
    throw new Error('the fixture does not parse');
  }
  const lines = key.getPrivatePEM().split('\n').filter(line => line !== '' && !line.startsWith('-----'));
  return lines.join('');
}

describe('saved credentials (REQ-REPO-001)', () => {
  let server: ServerProcess;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'front-burner-e2e-credentials-'));
    server = await startServerProcess({ FRONT_BURNER_SETUP_TOKEN: E2E_SETUP_TOKEN, FRONT_BURNER_DATA_DIR: dataDir });
    await onboard(server);
  });

  afterAll(async () => {
    await server?.stop();
    rmSync(dataDir, { recursive: true, force: true });
  });

  const authorized = (authToken: string) => ({ authorization: `Bearer ${authToken}` });

  async function sshKeys(authToken: string): Promise<SavedSshKey[]> {
    const response = await fetch(`${server.url}/api/v1/credentials`, { headers: authorized(authToken) });
    expect(response.status).toBe(200);
    return ((await response.json()) as { sshKeys: SavedSshKey[]; }).sshKeys;
  }

  const unlock = (authToken: string, id: number, passphrase = FIXTURE_PASSPHRASE) =>
    postJson(server, `/api/v1/credentials/ssh-keys/${id}/unlock`, { passphrase }, authorized(authToken));

  it('criterion 10: an unlock ends with the session and is never stored or logged', async () => {
    const id = seedProtectedKey(dataDir, 1, 'Laptop');
    const first = await login(server, 'body');

    expect((await unlock(first.authToken, id)).status).toBe(204);
    expect((await sshKeys(first.authToken)).find(key => key.id === id)?.unlocked).toBe(true);

    const other = await login(server, 'body');
    expect((await sshKeys(other.authToken)).find(key => key.id === id)?.unlocked).toBe(false);

    const logout = await postJson(server, '/api/v1/auth/session/logout', { refreshToken: first.refreshToken });
    expect(logout.status).toBe(204);
    const again = await login(server, 'body');
    expect((await sshKeys(again.authToken)).find(key => key.id === id)?.unlocked).toBe(false);

    const secrets = [ FIXTURE_PASSPHRASE, decryptedKeyBody().slice(0, 48) ];
    for (const file of [ databaseFile(dataDir), `${databaseFile(dataDir)}-wal` ]) {
      if (existsSync(file)) {
        const content = readFileSync(file).toString('latin1');
        for (const secret of secrets) {
          expect(content).not.toContain(secret);
        }
      }
    }
    for (const secret of secrets) {
      expect(server.output()).not.toContain(secret);
    }
  });

  it('criterion 22: another user\'s credential answers 404 and is not listed', async () => {
    const [ bob ] = seed(dataDir, { users: [ { email: 'bob@example.com' } ] }).userIds;
    const bobsKey = seedProtectedKey(dataDir, bob as number, 'Bob\'s key');
    const { authToken } = await login(server, 'body');

    const response = await unlock(authToken, bobsKey);
    const unknown = await unlock(authToken, bobsKey + 1000);

    expect(response.status).toBe(404);
    const body = (await response.json()) as Record<string, unknown>;
    const unknownBody = (await unknown.json()) as Record<string, unknown>;
    expect({ ...body, requestId: '' }).toEqual({ ...unknownBody, requestId: '' });
    expect((await sshKeys(authToken)).map(key => key.id)).not.toContain(bobsKey);

    const bobLogin = await login(server, 'body', { email: 'bob@example.com', password: E2E_ADMIN.password });
    expect((await sshKeys(bobLogin.authToken)).map(key => key.id)).toEqual([ bobsKey ]);
  });

  it('a generated key survives a restart', async () => {
    const { authToken } = await login(server, 'body');
    const response = await postJson(
      server,
      '/api/v1/credentials/ssh-keys/generate',
      { name: 'Deploy' },
      authorized(authToken)
    );
    expect(response.status).toBe(201);
    const generated = (await response.json()) as { key: SavedSshKey; publicKey: string; };
    // fetch cannot set the Host header, so the instance host is the server's address.
    expect(generated.publicKey).toMatch(/^ssh-ed25519 \S+ front-burner@127\.0\.0\.1$/);

    await server.stop();
    server = await startServerProcess({ FRONT_BURNER_DATA_DIR: dataDir });

    const after = await login(server, 'body');
    expect((await sshKeys(after.authToken)).find(key => key.id === generated.key.id)).toMatchObject({
      name: 'Deploy',
      generated: true
    });
  });
});
