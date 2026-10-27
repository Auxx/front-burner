import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { connect, createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const gitEnv = {
  PATH: process.env['PATH'] ?? '/usr/bin:/bin',
  HOME: tmpdir(),
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_AUTHOR_NAME: 'Fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.com',
  GIT_COMMITTER_NAME: 'Fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.com'
};

/** Bare repositories under `root`: `handbook.git` with `main` and `draft`, and `empty.git`. */
export function createRemotes(root: string): { handbook: string; empty: string; } {
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: gitEnv });
  const work = join(root, 'work');
  const handbook = join(root, 'handbook.git');
  const empty = join(root, 'empty.git');
  mkdirSync(work, { recursive: true });
  git(root, 'init', '-q', '--bare', '-b', 'main', handbook);
  git(root, 'init', '-q', '--bare', '-b', 'main', empty);
  git(work, 'init', '-q', '-b', 'main');
  git(work, 'commit', '-q', '--allow-empty', '-m', 'first');
  git(work, 'branch', 'draft');
  git(work, 'push', '-q', handbook, 'main', 'draft');
  return { handbook, empty };
}

export interface HoldingProxy {
  port: number;
  /** Connections accepted so far. */
  readonly connections: number;
  /**
   * Connections from the `count`th on (0-based) wait, unanswered, until
   * {@link release}. A clone starts as soon as its submit commits, so tests
   * hold from the connection after the submit's access check.
   */
  holdFrom(count: number): void;
  /** Forwards the waiting connections and every later one. */
  release(): void;
  close(): Promise<void>;
}

/**
 * A TCP proxy on `127.0.0.1` in front of a test git server, which can stall a
 * clone the way a slow remote does.
 */
export async function startHoldingProxy(targetPort: number): Promise<HoldingProxy> {
  let holdFrom = Number.POSITIVE_INFINITY;
  let accepted = 0;
  const waiting: Socket[] = [];
  const sockets = new Set<Socket>();
  const forward = (client: Socket) => {
    const upstream = connect(targetPort, '127.0.0.1');
    sockets.add(upstream);
    client.pipe(upstream).pipe(client);
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
  };
  const server: Server = createServer(client => {
    sockets.add(client);
    if (accepted++ >= holdFrom) {
      client.pause();
      waiting.push(client);
    } else {
      forward(client);
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as { port: number; }).port,
    get connections() {
      return accepted;
    },
    holdFrom: count => {
      holdFrom = count;
    },
    release: () => {
      holdFrom = Number.POSITIVE_INFINITY;
      for (const client of waiting.splice(0)) {
        forward(client);
        client.resume();
      }
    },
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  };
}
