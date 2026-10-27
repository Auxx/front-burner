import { workspaceRoot } from '@nx/devkit';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A copy of the server's test certificate and key (web-e2e cannot import
// server libraries, A-2.4): self-signed for `localhost`, `127.0.0.1` and
// `::1`, valid until 2036.
const FIXTURES = join(workspaceRoot, 'apps/web-e2e/src/support/fixtures');

/** The certificate that the instance's git must trust, for `InstanceOptions.gitCaFile`. */
export const TEST_CERTIFICATE_FILE = join(FIXTURES, 'test.crt');

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

/** A bare repository under `root`, `handbook.git`, with the branches `main` (its default) and `feature/x`. */
export function createHandbookRemote(root: string): string {
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: gitEnv });
  const work = join(root, 'work');
  const handbook = join(root, 'handbook.git');
  mkdirSync(work, { recursive: true });
  git(root, 'init', '-q', '--bare', '-b', 'main', handbook);
  git(work, 'init', '-q', '-b', 'main');
  git(work, 'commit', '-q', '--allow-empty', '-m', 'first');
  git(work, 'branch', 'feature/x');
  git(work, 'push', '-q', handbook, 'main', 'feature/x');
  return handbook;
}

export interface GitHttpServer {
  /** `https://127.0.0.1:<port>`, without a trailing slash. */
  url: string;
  close(): Promise<void>;
}

export interface GitHttpServerOptions {
  /** URL path (such as `handbook.git`) → bare repository on disk. */
  repositories: Record<string, string>;
  /** User name → password; when given, every request needs Basic authentication. */
  users?: Record<string, string>;
}

function authorised(request: IncomingMessage, users: Record<string, string> | undefined): boolean {
  if (users === undefined) {
    return true;
  }
  const match = /^Basic (.+)$/.exec(request.headers.authorization ?? '');
  if (!match) {
    return false;
  }
  const decoded = Buffer.from(match[1] ?? '', 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  return colon > 0 && users[decoded.slice(0, colon)] === decoded.slice(colon + 1);
}

/** Runs `git http-backend` as a CGI script for one request. */
function serveGit(request: IncomingMessage, response: ServerResponse, repository: string, pathInfo: string): void {
  const url = new URL(request.url ?? '/', 'https://localhost');
  const env: Record<string, string> = {
    ...gitEnv,
    GIT_PROJECT_ROOT: repository,
    GIT_HTTP_EXPORT_ALL: '1',
    PATH_INFO: pathInfo,
    REQUEST_METHOD: request.method ?? 'GET',
    QUERY_STRING: url.search.slice(1),
    CONTENT_TYPE: request.headers['content-type'] ?? '',
    REMOTE_ADDR: request.socket.remoteAddress ?? '',
    REMOTE_USER: 'git'
  };
  const encoding = request.headers['content-encoding'];
  if (typeof encoding === 'string') {
    env['HTTP_CONTENT_ENCODING'] = encoding;
  }
  const protocol = request.headers['git-protocol'];
  if (typeof protocol === 'string') {
    env['HTTP_GIT_PROTOCOL'] = protocol;
  }
  const child = spawn('git', [ 'http-backend' ], { env, stdio: [ 'pipe', 'pipe', 'ignore' ] });
  request.pipe(child.stdin);
  child.stdin.on('error', () => undefined);

  let head = Buffer.alloc(0);
  let headersSent = false;
  child.stdout.on('data', (chunk: Buffer) => {
    if (headersSent) {
      response.write(chunk);
      return;
    }
    head = Buffer.concat([ head, chunk ]);
    const end = head.indexOf('\r\n\r\n');
    if (end < 0) {
      return;
    }
    headersSent = true;
    let status = 200;
    for (const line of head.subarray(0, end).toString('latin1').split('\r\n')) {
      const colon = line.indexOf(':');
      const [ name, value ] = [ line.slice(0, colon), line.slice(colon + 1).trim() ];
      if (name.toLowerCase() === 'status') {
        status = parseInt(value, 10);
      } else {
        response.setHeader(name, value);
      }
    }
    response.writeHead(status);
    response.write(head.subarray(end + 4));
  });
  child.on('close', () => {
    if (!headersSent) {
      response.writeHead(500);
    }
    response.end();
  });
}

/**
 * An HTTPS git server on `127.0.0.1` with the test certificate, serving bare
 * repositories with `git http-backend`. The instance trusts it when started
 * with `gitCaFile: TEST_CERTIFICATE_FILE`.
 */
export async function startGitHttpServer(options: GitHttpServerOptions): Promise<GitHttpServer> {
  const server = createServer({
    cert: readFileSync(TEST_CERTIFICATE_FILE, 'utf8'),
    key: readFileSync(join(FIXTURES, 'test.key'), 'utf8')
  }, (request, response) => {
    if (!authorised(request, options.users)) {
      response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="git"' });
      response.end();
      return;
    }
    const path = new URL(request.url ?? '/', 'https://localhost').pathname;
    const name = Object.keys(options.repositories).find(repository => path.startsWith(`/${repository}/`));
    if (name === undefined) {
      response.writeHead(404);
      response.end('Not Found');
      return;
    }
    serveGit(request, response, options.repositories[name] ?? '', path.slice(name.length + 1));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `https://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>(resolve => {
        server.closeAllConnections();
        server.close(() => resolve());
      })
  };
}
