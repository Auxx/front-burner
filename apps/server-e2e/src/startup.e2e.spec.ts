import { startGitHttpServer } from '@front-burner/server-core-git/testing';
import BetterSqlite3 from 'better-sqlite3';
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { waitFor } from './support/git-api';
import { createRemotes } from './support/git-remotes';
import {
  E2E_SETUP_TOKEN,
  login,
  onboard,
  runServerToExit,
  seed,
  type ServerProcess,
  startServerProcess
} from './support/server-process';

interface Summary {
  id: number;
  status: string;
}

async function repositories(server: ServerProcess, authToken: string): Promise<Summary[]> {
  const response = await fetch(`${server.url}/api/v1/repositories/recent`, {
    headers: { authorization: `Bearer ${authToken}` }
  });
  return ((await response.json()) as { repositories: Summary[]; }).repositories;
}

describe('server startup', () => {
  const cleanups: (() => void | Promise<void>)[] = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()!();
    }
  });

  it('refuses to start with an invalid port', async () => {
    const { code, output } = await runServerToExit({ FRONT_BURNER_PORT: 'abc' });
    expect(code).toBe(1);
    expect(output).toContain('FRONT_BURNER_PORT');
    expect(output).toContain('"step":"config"');
  });

  it.skipIf(process.getuid?.() === 0)('refuses to start with an unwritable data directory', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'front-burner-e2e-ro-'));
    const dataDir = join(parent, 'data');
    mkdirSync(dataDir);
    chmodSync(dataDir, 0o500);
    cleanups.push(() => {
      chmodSync(dataDir, 0o700);
      rmSync(parent, { recursive: true, force: true });
    });
    const { code, output } = await runServerToExit({ FRONT_BURNER_DATA_DIR: dataDir });
    expect(code).toBe(1);
    expect(output).toContain('"step":"data-dir"');
    expect(output).toContain(dataDir);
  });

  it('refuses to start with a newer database', async () => {
    const { code, output } = await runServerToExit({}, {
      prepare: dataDir => {
        mkdirSync(join(dataDir, 'db'), { recursive: true });
        const sqlite = new BetterSqlite3(join(dataDir, 'db', 'front-burner.sqlite'));
        sqlite.exec(
          'CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC)'
        );
        sqlite.exec('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (\'future\', 9999999999999)');
        sqlite.close();
      }
    });
    expect(code).toBe(1);
    expect(output).toContain('"step":"migrations"');
    expect(output).toContain('newer version of Front Burner');
  });

  it('refuses to start when the port is in use', async () => {
    const holder: Server = createServer();
    await new Promise<void>(resolve => holder.listen(0, '0.0.0.0', resolve));
    cleanups.push(() => new Promise<void>(resolve => holder.close(() => resolve())));
    const { port } = holder.address() as { port: number; };
    const { code, output } = await runServerToExit({ FRONT_BURNER_PORT: String(port) });
    expect(code).toBe(1);
    expect(output).toContain('"step":"http"');
    expect(output).toContain(String(port));
  });

  it('logs the absolute data directory', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'front-burner-e2e-cwd-'));
    cleanups.push(() => rmSync(cwd, { recursive: true, force: true }));
    const server = await startServerProcess({ FRONT_BURNER_DATA_DIR: 'relative-data' }, { cwd });
    cleanups.push(() => server.stop());
    expect(server.output()).toContain(join(realpathSync(cwd), 'relative-data'));
  });

  it('a clone lands under FRONT_BURNER_REPOS_DIR', async () => {
    const root = mkdtempSync(join(tmpdir(), 'front-burner-e2e-repos-dir-'));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const remotes = createRemotes(join(root, 'remotes'));
    const git = await startGitHttpServer({ repositories: { 'handbook.git': remotes.handbook } });
    cleanups.push(() => git.close());
    // An operator mounts the volume: the directory exists, empty.
    const reposDir = join(root, 'slow');
    mkdirSync(reposDir);
    const server = await startServerProcess({ FRONT_BURNER_SETUP_TOKEN: E2E_SETUP_TOKEN }, { reposDir });
    cleanups.push(() => server.stop());
    const userId = await onboard(server);
    const { authToken } = await login(server);

    const response = await fetch(`${server.url}/api/v1/repositories`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        remoteUrl: `${git.url}/handbook.git`,
        name: 'Handbook',
        credentials: { mode: 'none' },
        cloneMode: 'full'
      })
    });
    expect(response.status).toBe(201);
    await waitFor(async () => (await repositories(server, authToken)).every(summary => summary.status !== 'cloning'));
    const [ repository ] = await repositories(server, authToken);

    expect(repository.status).toBe('ready');
    expect(existsSync(join(reposDir, 'repos', String(userId), String(repository.id), '.git'))).toBe(true);
    expect(readdirSync(reposDir).sort()).toEqual([ 'orphans', 'repos', 'tmp' ]);
    expect(readdirSync(join(reposDir, 'tmp'))).toEqual([]);
    // Nothing is written to <data>/repos, nor to a tmp/ there.
    expect(readdirSync(server.dataDir).sort()).toEqual([ 'backups', 'db' ]);
  });

  it('a fresh instance has a database snapshot a moment after it starts', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'front-burner-e2e-snapshots-'));
    cleanups.push(() => rmSync(dataDir, { recursive: true, force: true }));
    const env = { FRONT_BURNER_DATA_DIR: dataDir };
    const backups = join(dataDir, 'backups');
    /** How many runs of the snapshot job have ended well. */
    const snapshotRuns = () => {
      const sqlite = new BetterSqlite3(join(dataDir, 'db', 'front-burner.sqlite'), { readonly: true });
      try {
        return sqlite.prepare('SELECT count(*) FROM jobs WHERE type = ? AND status = ?')
          .pluck().get('database.snapshot', 'done') as number;
      } finally {
        sqlite.close();
      }
    };
    const first = await startServerProcess(env);

    await waitFor(() => snapshotRuns() === 1);
    const [ snapshot ] = readdirSync(backups);
    expect(snapshot).toMatch(/^front-burner-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\dZ-v[\w.+-]+\.sqlite$/);
    await first.stop();
    const copy = new BetterSqlite3(join(backups, snapshot), { readonly: true });
    try {
      expect(copy.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(copy.prepare('SELECT count(*) FROM __drizzle_migrations').pluck().get()).toBeGreaterThan(0);
    } finally {
      copy.close();
    }
  });

  it('a working copy left by a removed row is in orphans after a restart', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'front-burner-e2e-orphans-'));
    cleanups.push(() => rmSync(dataDir, { recursive: true, force: true }));
    const env = { FRONT_BURNER_DATA_DIR: dataDir, FRONT_BURNER_SETUP_TOKEN: E2E_SETUP_TOKEN };
    const first = await startServerProcess(env);
    const userId = await onboard(first);
    // Error rows: neither recovery nor the start check runs git in these folders.
    const { repositoryIds: [ kept, removed ] } = seed(dataDir, {
      repositories: [ 'kept', 'removed' ].map(name => ({
        userId,
        name,
        status: 'error' as const,
        errorCode: 'clone-failed' as const,
        lastAccessedAt: new Date()
      }))
    });
    const workingCopy = (id: number) => join(dataDir, 'repos', String(userId), String(id));
    for (const id of [ kept, removed ]) {
      mkdirSync(join(workingCopy(id), '.git'), { recursive: true });
      writeFileSync(join(workingCopy(id), 'notes.md'), 'unpushed work');
    }
    await first.stop();
    // As a database restored from a snapshot older than the second repository.
    const sqlite = new BetterSqlite3(join(dataDir, 'db', 'front-burner.sqlite'));
    sqlite.prepare('DELETE FROM repositories WHERE id = ?').run(removed);
    sqlite.close();

    const second = await startServerProcess(env);
    cleanups.push(() => second.stop());

    expect(existsSync(workingCopy(kept))).toBe(true);
    expect(existsSync(workingCopy(removed))).toBe(false);
    const [ orphan ] = readdirSync(join(dataDir, 'orphans'));
    expect(orphan).toMatch(new RegExp(`^${userId}-${removed}-\\d{4}-\\d\\d-\\d\\dT\\d\\d-\\d\\d-\\d\\dZ$`));
    expect(readFileSync(join(dataDir, 'orphans', orphan, 'notes.md'), 'utf8')).toBe('unpushed work');
    expect(second.output()).toContain(
      `Working copy of repository ${removed} (user ${userId}) has no repository; moved to orphans/${orphan}`
    );
  });

  it('ships executable git helpers', async () => {
    const helpers = resolve(import.meta.dirname, '../../../dist/apps/server/git-helpers');
    for (const helper of [ 'askpass.cjs', 'proxy-connect.cjs' ]) {
      expect(() => accessSync(join(helpers, helper), constants.X_OK), helper).not.toThrow();
    }

    const server = await startServerProcess({});
    cleanups.push(() => server.stop());

    expect(server.output()).not.toContain('"step":"git"');
  });
});
