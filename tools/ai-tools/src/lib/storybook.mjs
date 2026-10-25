import { existsSync, readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { OutsideWorkspaceError, resolveInWorkspace, workspacePath } from './workspace.mjs';

/** Where `nx run ui:build-storybook` puts the static Storybook. */
export const DEFAULT_STORYBOOK = 'dist/storybook/ui';

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf'
};

/** Resolves the static Storybook folder and checks that it has been built. */
export function storybookDir(path = DEFAULT_STORYBOOK) {
  const dir = resolveInWorkspace(path);
  if (!existsSync(join(dir, 'index.json'))) {
    throw new Error(`No built Storybook in ${workspacePath(dir)}; run: npx nx run ui:build-storybook`);
  }
  return dir;
}

/** When the static Storybook was built, for a warning when the sources are newer. */
export function builtAt(dir) {
  return statSync(join(dir, 'index.json')).mtime;
}

/** The stories (not docs pages) of a built Storybook whose id or title contains `filter`. */
export function listStories(dir, filter = '') {
  const { entries } = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
  const needle = filter.toLowerCase();
  return Object.values(entries)
    .filter(entry => entry.type === 'story')
    .filter(entry => entry.id.includes(needle) || entry.title.toLowerCase().includes(needle))
    .map(({ id, title, name }) => ({ id, title, name }));
}

/**
 * Serves a static folder on a random local port. Requests that would leave
 * the folder, including through symbolic links, get a 404.
 */
export async function serve(dir) {
  const server = createServer(async (request, response) => {
    try {
      const { pathname } = new URL(request.url, 'http://localhost');
      const relative = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
      const file = resolveInWorkspace(relative, { base: dir, root: dir });
      const body = await readFile(file);
      response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      response.end(body);
    } catch (error) {
      response.writeHead(error instanceof OutsideWorkspaceError ? 403 : 404);
      response.end();
    }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise(done => server.close(done)) };
}

/**
 * The variants to open a story in: every combination of the given themes and
 * densities, each with the same forced colours, reduced motion and viewport.
 */
export function variants({ theme = [ 'light' ], density = [ 'compact' ], forcedColors, reducedMotion, viewport }) {
  return theme.flatMap(t => density.map(d => ({ theme: t, density: d, forcedColors, reducedMotion, viewport })));
}

/** A file-name-safe label of a variant: `dark-touch-forced-480x640`. */
export function variantLabel({ theme, density, forcedColors, reducedMotion, viewport }) {
  return [
    theme,
    density,
    forcedColors && 'forced',
    reducedMotion && 'reduced',
    `${viewport.width}x${viewport.height}`
  ].filter(Boolean).join('-');
}

/** Parses `480x640`. */
export function parseViewport(text) {
  const match = /^(\d{2,5})x(\d{2,5})$/.exec(text);
  if (!match) {
    throw new Error(`Not a viewport (WIDTHxHEIGHT): ${text}`);
  }
  return { width: Number(match[1]), height: Number(match[2]) };
}

/**
 * Opens a story in a new browser context with the variant's settings and
 * waits until Storybook has rendered it, the fonts have loaded and `wait`
 * more milliseconds have passed (for play functions and transitions). Throws
 * Storybook's error message when the story fails to render.
 */
export async function openStory(browser, baseUrl, id, variant, { wait = 300 } = {}) {
  const context = await browser.newContext({
    viewport: variant.viewport,
    colorScheme: variant.theme === 'dark' ? 'dark' : 'light',
    forcedColors: variant.forcedColors ? 'active' : 'none',
    reducedMotion: variant.reducedMotion ? 'reduce' : 'no-preference',
    hasTouch: variant.density === 'touch'
  });
  const page = await context.newPage();
  const globals = `theme:${variant.theme};density:${variant.density}`;
  await page.goto(`${baseUrl}/iframe.html?id=${encodeURIComponent(id)}&viewMode=story&globals=${globals}`);
  await page.waitForFunction(() => /sb-show-(main|errordisplay|nopreview)/.test(document.body.className));
  const failure = await page.evaluate(() =>
    document.body.classList.contains('sb-show-main')
      ? null
      : document.querySelector('#error-message')?.textContent?.trim() || 'Story did not render'
  );
  if (failure) {
    await context.close();
    throw new Error(`${id}: ${failure}`);
  }
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(wait);
  return { page, close: () => context.close() };
}

/** Launches Chromium (headless), as the Storybook tests do. */
export async function launchBrowser() {
  const { chromium } = await import('playwright');
  return chromium.launch();
}
