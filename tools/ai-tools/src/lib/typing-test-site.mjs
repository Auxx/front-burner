import { build } from 'esbuild';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { generateMarkdown, TYPING_TEST_FILES } from './typing-test.mjs';
import { resolveInWorkspace, WORKSPACE_ROOT } from './workspace.mjs';

const SOURCE_DIR = join(WORKSPACE_ROOT, 'tools/ai-tools/src/typing-test');

export const DEFAULT_OUT_DIR = 'tmp/typing-test';

/** Every file the site has, by URL path, with its content type: the server serves nothing else. */
export const SITE_FILES = Object.freeze({
  '/index.html': { name: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { name: 'app.js', type: 'text/javascript; charset=utf-8' },
  ...Object.fromEntries(
    Object.keys(TYPING_TEST_FILES).map(name => [ `/${name}`, { name, type: 'text/markdown; charset=utf-8' } ])
  )
});

/**
 * Builds the typing test page into `out` (inside the workspace): the bundled
 * page, its HTML and the generated test files. Returns the sizes of what it wrote.
 */
export async function buildSite(out = DEFAULT_OUT_DIR) {
  const dir = resolveInWorkspace(out);
  mkdirSync(dir, { recursive: true });
  await build({
    entryPoints: [ join(SOURCE_DIR, 'page.mjs') ],
    bundle: true,
    minify: true,
    format: 'esm',
    target: 'es2022',
    outfile: join(dir, 'app.js'),
    logLevel: 'silent'
  });
  writeFileSync(join(dir, 'index.html'), readFileSync(join(SOURCE_DIR, 'index.html')));
  const files = Object.entries(TYPING_TEST_FILES).map(([ name, maxBytes ]) => {
    const text = generateMarkdown(maxBytes);
    writeFileSync(join(dir, name), text);
    return { name, bytes: Buffer.byteLength(text) };
  });
  const app = readFileSync(join(dir, 'app.js'));
  return { dir, appBytes: app.length, appGzipBytes: gzipSync(app).length, files };
}

/** Serves the built site from `dir`: only the files of `SITE_FILES`, never cached. */
export function createSiteServer(dir) {
  return createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    const file = SITE_FILES[path === '/' ? '/index.html' : path];
    if (request.method !== 'GET' || !file) {
      response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    const body = readFileSync(join(dir, file.name));
    response.writeHead(200, { 'Content-Type': file.type, 'Content-Length': body.length, 'Cache-Control': 'no-store' });
    response.end(body);
  });
}

/** The addresses on which a phone on the same network can reach `port`. */
export function siteUrls(port) {
  return Object.values(networkInterfaces())
    .flat()
    .filter(address => address && address.family === 'IPv4' && !address.internal)
    .map(address => `http://${address.address}:${port}/`);
}

/** Whether the site in `dir` has been built. */
export function isBuilt(dir) {
  try {
    return Object.values(SITE_FILES).every(file => statSync(join(dir, file.name)).isFile());
  } catch {
    return false;
  }
}
