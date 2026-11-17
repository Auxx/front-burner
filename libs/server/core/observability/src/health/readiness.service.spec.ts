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
  let low: boolean;
  const disks = { isLow: () => low };

  beforeEach(() => {
    low = false;
    dir = mkdtempSync(join(tmpdir(), 'fb-ready-'));
    database = openDatabase(join(dir, 'db.sqlite'));
    config = {
      version: '0.0.0',
      port: 3000,
      trustedProxies: [],
      logLevel: 'info',
      logFormat: 'json',
      dataDir: dir,
      reposRoot: dir,
      setupToken: undefined,
      jwtSecret: 'spec-jwt-secret-0123456789abcdefghijklmnopqrstu',
      encryptionKey: 'spec-encryption-key-0123456789abcdefghijklmnop',
      encryptionKeyReset: false,
      blockPrivateNetworks: false,
      authTokenTtlMs: 900_000,
      refreshTokenTtlMs: 2_592_000_000,
      loginAuditRetentionMs: 7_776_000_000,
      cloneTimeoutMs: 1_800_000,
      cloneConcurrency: 2,
      gitTimeoutMs: 300_000,
      keyUnlockIdleMs: 3_600_000,
      dbSnapshotIntervalMs: 86_400_000,
      dbSnapshotKeep: 7,
      lowDiskThresholdBytes: 2_147_483_648,
      knownHostsFile: undefined,
      oidc: undefined,
      oidcRequiredClaim: undefined
    };
  });

  afterEach(() => {
    if (database.sqlite.open) {
      database.sqlite.close();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('is ok with a working database, applied migrations and a writable directory', () => {
    expect(new ReadinessService(config, database, true, disks).check()).toBe('ok');
  });

  it('fails when the database is closed', () => {
    database.sqlite.close();
    expect(new ReadinessService(config, database, true, disks).check()).toBe('fail');
  });

  it('fails when migrations were not applied', () => {
    expect(new ReadinessService(config, database, false, disks).check()).toBe('fail');
  });

  it('is degraded while low on storage', () => {
    low = true;
    expect(new ReadinessService(config, database, true, disks).check()).toBe('degraded');
  });

  it('fails rather than degraded when both apply', () => {
    low = true;
    expect(new ReadinessService(config, database, false, disks).check()).toBe('fail');
  });

  // Mode bits do not make a folder unwritable on Windows, nor for root.
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'fails when the data directory is not writable',
    () => {
      const readOnly = join(dir, 'ro');
      mkdirSync(readOnly, { mode: 0o500 });
      expect(new ReadinessService({ ...config, dataDir: readOnly }, database, true, disks).check()).toBe('fail');
    }
  );

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'fails when the repositories directory is not writable',
    () => {
      const readOnly = join(dir, 'ro');
      mkdirSync(readOnly, { mode: 0o500 });
      expect(new ReadinessService({ ...config, reposRoot: readOnly }, database, true, disks).check()).toBe('fail');
    }
  );
});
