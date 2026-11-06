import type { Config } from '@front-burner/server-core-config';
import { SecretBox } from '@front-burner/server-core-crypto';
import { Database, savedCredentials } from '@front-burner/server-core-database';
import type { EventsHub } from '@front-burner/server-core-events';
import { GitEngine, GitRunner } from '@front-burner/server-core-git';
import { GitHttpServer, startGitHttpServer } from '@front-burner/server-core-git/testing';
import { SessionLifecycle } from '@front-burner/server-core-security';
import {
  KeyUnlockStore,
  KnownHostsService,
  SavedCredentialsService,
  UnlockAttempts
} from '@front-burner/server-feature-credentials';
import { parseRemoteUrl } from '@front-burner/shared-util';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { insertUser } from '../testing/fixtures';
import { createRemotes, testGitOptions, trustTestCertificate } from '../testing/git-fixtures';
import { createTestDatabase } from '../testing/test-database';
import { CredentialsCheck } from './credentials-check';
import type { ResolvedCredentials } from './request-credentials';

const box = new SecretBox('credentials-check-spec-key-0123456789abcd');
const TOKEN = 'ghp_s3cret-token';

const fieldError = (path: string, code: string, params: Record<string, unknown> = {}) =>
  expect.objectContaining({ code: 'validation-failed', fields: [ { path, code, params } ] });

const https = (password: string): ResolvedCredentials => ({
  git: { kind: 'https', username: 'alice', password },
  savedId: undefined,
  generated: false,
  protectedKey: false
});

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('did not fail');
}

describe('CredentialsCheck', () => {
  let restoreCa: () => void;
  let root: string;
  let server: GitHttpServer;
  let database: Database;
  let unlocks: KeyUnlockStore;
  let saved: SavedCredentialsService;
  let check: CredentialsCheck;
  let alice: number;

  const url = () => `${server.url}/handbook.git`;
  const remote = () => {
    const parsed = parseRemoteUrl(url());
    if (!('remote' in parsed)) {
      throw new Error('bad URL');
    }
    return parsed.remote;
  };

  beforeAll(() => {
    restoreCa = trustTestCertificate();
  });

  afterAll(() => {
    restoreCa();
  });

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'fb-credentials-check-'));
    createRemotes(root);
    server = await startGitHttpServer({
      repositories: { 'handbook.git': join(root, 'handbook.git') },
      users: { alice: TOKEN }
    });
    database = createTestDatabase();
    unlocks = new KeyUnlockStore({ keyUnlockIdleMs: 3_600_000 } as Config, new SessionLifecycle(), {
      publishToSession: vi.fn()
    } as unknown as EventsHub);
    saved = new SavedCredentialsService(database, box, unlocks, new UnlockAttempts());
    const gitOptions = testGitOptions();
    check = new CredentialsCheck(
      database,
      saved,
      new KnownHostsService(database, gitOptions),
      new GitEngine(gitOptions, new GitRunner())
    );
    alice = insertUser(database, 'alice@x.io');
  });

  afterEach(async () => {
    unlocks.onModuleDestroy();
    await server.close();
    database.sqlite.close();
    rmSync(root, { recursive: true, force: true });
  });

  // The broker listens on a Unix socket in a POSIX path: not on Windows.
  it.skipIf(process.platform === 'win32')('lists the branches with credentials that work', async () => {
    expect(await check.check({ id: alice }, url(), remote(), 'new-https', https(TOKEN))).toEqual({
      branches: [ 'draft', 'main' ],
      defaultBranch: 'main'
    });
  });

  // The broker listens on a Unix socket in a POSIX path: not on Windows.
  it.skipIf(process.platform === 'win32')('reports refused credentials as the Add repository page does', async () => {
    const error = await rejectionOf(check.check({ id: alice }, url(), remote(), 'new-https', https('wrong')));

    expect(error).toEqual(fieldError('credentials', 'credentials-refused', { generatedKey: false }));
  });

  it('refuses a taken name of the same kind, ignoring case', () => {
    database.db.transaction(tx => saved.createHttps(tx, alice, { name: 'work', username: 'a', password: 'p' }));

    expect(() => check.assertNameFree(alice, { mode: 'new-https', name: 'Work', username: 'a', password: 'p' }))
      .toThrow(fieldError('credentials.name', 'name-taken'));
    expect(() => check.assertNameFree(alice, { mode: 'new-ssh-key', name: 'Work', privateKey: 'k' })).not.toThrow();
    expect(() => check.assertNameFree(alice, { mode: 'saved', credentialId: 1 })).not.toThrow();
  });

  it('saves only new credentials, and reports their problems under credentials', () => {
    const id = database.db.transaction(tx =>
      check.saveNew(tx, alice, { mode: 'new-https', name: 'Work', username: 'alice', password: TOKEN })
    );

    expect(database.db.select().from(savedCredentials).all()).toEqual([
      expect.objectContaining({ id, kind: 'https', name: 'Work', username: 'alice' })
    ]);
    expect(database.db.transaction(tx => check.saveNew(tx, alice, { mode: 'none' }))).toBeUndefined();
    expect(() =>
      database.db.transaction(tx =>
        check.saveNew(tx, alice, { mode: 'new-ssh-key', name: 'Laptop', privateKey: 'not a key' })
      )
    ).toThrow(expect.objectContaining({ fields: [ expect.objectContaining({ path: 'credentials.privateKey' }) ] }));
  });
});
