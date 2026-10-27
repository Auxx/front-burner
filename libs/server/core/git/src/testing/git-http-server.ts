import { startHttpsTestServer } from '@front-burner/server-core-security/testing';
import { spawn } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';

export interface GitHttpServer {
  /** `https://127.0.0.1:<port>`, without a trailing slash. */
  url: string;
  /** The certificate to trust. */
  ca: string;
  close(): Promise<void>;
}

export interface GitHttpServerOptions {
  /** URL path (such as `repo.git`) → bare repository on disk. */
  repositories: Record<string, string>;
  /** User name → password; when given, every request needs Basic authentication. */
  users?: Record<string, string>;
  /** Waits this long before answering each request. */
  delayMs?: number;
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
    PATH: process.env['PATH'] ?? '/usr/bin:/bin',
    HOME: tmpdir(),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_PROJECT_ROOT: repository,
    GIT_HTTP_EXPORT_ALL: '1',
    PATH_INFO: pathInfo,
    REQUEST_METHOD: request.method ?? 'GET',
    QUERY_STRING: url.search.slice(1),
    CONTENT_TYPE: request.headers['content-type'] ?? '',
    REMOTE_ADDR: request.socket.remoteAddress ?? '',
    REMOTE_USER: 'git'
  };
  for (
    const [ header, variable ] of [ [ 'content-encoding', 'HTTP_CONTENT_ENCODING' ], [
      'git-protocol',
      'HTTP_GIT_PROTOCOL'
    ] ]
  ) {
    const value = request.headers[header as string];
    if (typeof value === 'string') {
      env[variable as string] = value;
    }
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
 * An HTTPS server with the test certificate that serves bare repositories with
 * `git http-backend`, for specs of git over HTTPS. Trust it with
 * `GIT_SSL_CAINFO` set to `TEST_CERTIFICATE_FILES.cert`.
 */
export async function startGitHttpServer(options: GitHttpServerOptions): Promise<GitHttpServer> {
  return startHttpsTestServer((request, response) => {
    const answer = () => {
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
    };
    if (options.delayMs) {
      // Paused meanwhile, so the request body is still there when http-backend reads it.
      request.pause();
      setTimeout(answer, options.delayMs);
    } else {
      answer();
    }
  });
}
