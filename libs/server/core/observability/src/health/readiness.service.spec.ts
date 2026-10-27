import { Config } from '@front-burner/server-core-config';
import { Database, openDatabase } from '@front-burner/server-core-database';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReadinessService } from './readiness.service';

describe('ReadinessService', () => {
  let dir: string;
  let database: Database;
  let config: Config;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fb-ready-'));
    database = openDatabase(join(dir, 'db.sqlite'));
    config = {
      port: 3000,
      trustedProxies: [],
      logLevel: 'info',
      logFormat: 'json',
      dataDir: dir,
      setupToken: undefined,
      jwtSecret: 'spec-jwt-secret-0123456789abcdefghijklmnopqrstu',
      encryptionKey: 'spec-encryption-key-0123456789abcdefghijklmnop',
      encryptionKeyReset: false,
      blockPrivateNetworks: false,
      authTokenTtlMs: 900_000,
      refreshTokenTtlMs: 2_592_000_000,
      loginAuditRetentionMs: 7_776_000_000,
      cloneTimeoutMs: 1_800_000,
      gitTimeoutMs: 300_000,
      knownHostsFile: undefined,
      oidc: undefined
    };
  });

  afterEach(() => {
    if (database.sqlite.open) {
      database.sqlite.close();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('is ok with a working database, applied migrations and a writable directory', () => {
    expect(new ReadinessService(config, database, true).check()).toBe('ok');
  });

  it('fails when the database is closed', () => {
    database.sqlite.close();
    expect(new ReadinessService(config, database, true).check()).toBe('fail');
  });

  it('fails when migrations were not applied', () => {
    expect(new ReadinessService(config, database, false).check()).toBe('fail');
  });

  it.skipIf(process.getuid?.() === 0)('fails when the data directory is not writable', () => {
    const readOnly = join(dir, 'ro');
    mkdirSync(readOnly, { mode: 0o500 });
    expect(new ReadinessService({ ...config, dataDir: readOnly }, database, true).check()).toBe('fail');
  });
});
