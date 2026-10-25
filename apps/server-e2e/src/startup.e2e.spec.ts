import BetterSqlite3 from 'better-sqlite3';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runServerToExit, startServerProcess } from './support/server-process';

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
});
