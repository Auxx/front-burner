/**
 * `perf-screen.mjs`: NF-2's screen targets in a throttled Chromium, timed
 * with the web client's own performance marks (A-8.17). The pure part is at
 * the top; the browser part needs Playwright's Chromium and a running
 * instance.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { git, markdownOf } from './perf-api.mjs';

export const DEFAULT_WORK = 'tmp/ai-tools/perf-screen';
const FOLDER = 'many';
const FOLDER_ENTRIES = 1000;
const EDITOR_FILE = 'big.md';
const PREVIEW_FILE = 'preview.md';
/** The web client's `localStorage` key of the session (LG-40). */
const AUTH_KEY = 'front-burner.auth';
/** The session is refreshed before a run when its auth token has less left than this; a run takes under a minute. */
const RENEW_MARGIN_MS = 5 * 60_000;
/** How long one measure may wait for its mark; slow 4G and a 4× slower CPU are slow. */
const MARK_WAIT_MS = 60_000;

/**
 * Chrome DevTools' "Slow 4G" preset (NF-2, "Reference host"), as DevTools
 * sets it: Lighthouse's slow 4G (150 ms, 1.6 Mbit/s down, 750 kbit/s up)
 * with DevTools' request-level adjustment, the latency × 3.75 and the
 * throughput × 0.9.
 */
export const SLOW_4G = Object.freeze({
  offline: false,
  latency: 150 * 3.75,
  downloadThroughput: ((1.6 * 1000 * 1000) / 8) * 0.9,
  uploadThroughput: ((750 * 1000) / 8) * 0.9
});

/**
 * The browsers measured: a desktop, and a phone with Playwright's Pixel 7
 * and a CPU 4 times slower, as `typing-test.mjs` and the preview's e2e test
 * take a mid-range phone to be.
 */
export const PROFILES = Object.freeze({
  desktop: { device: 'Desktop Chrome', cpuRate: 1 },
  phone: { device: 'Pixel 7', cpuRate: 4 }
});

/**
 * The measures and their targets (NF-2). `network` is the throttling while
 * the measured step runs; `profiles` limits a measure to some profiles.
 */
export const SCREEN_OPERATIONS = Object.freeze({
  'first-load': {
    label: 'First load, cold cache',
    rule: 'NF-2.7',
    kind: 'screen',
    targetMs: 5000,
    network: 'slow-4g'
  },
  'first-load-warm': { label: 'First load, warm cache', rule: 'NF-2.7', kind: 'info', network: 'slow-4g' },
  folder: {
    label: 'Show a folder of 1,000 entries',
    rule: 'NF-2.1',
    kind: 'screen',
    targetMs: 1000,
    network: 'slow-4g'
  },
  'editor-broadband': {
    label: 'Editor usable, 100 KB, broadband',
    rule: 'NF-2.2',
    kind: 'screen',
    targetMs: 1000,
    network: 'none',
    profiles: [ 'desktop' ]
  },
  'editor-slow-4g': {
    label: 'Editor usable, 100 KB, slow 4G',
    rule: 'NF-2.2',
    kind: 'screen',
    targetMs: 2000,
    network: 'slow-4g'
  },
  preview: {
    label: 'Preview updated, 200 KB',
    rule: 'NF-2.5',
    kind: 'screen',
    targetMs: 300,
    network: 'none'
  }
});

/** The measures that the command line asks for: `first-load` brings its warm row. */
export const MEASURES = [ 'first-load', 'folder', 'editor-broadband', 'editor-slow-4g', 'preview' ];

/**
 * The measures to run for `profile`, from a comma-separated `--measures`
 * list (all when empty); throws on an unknown name.
 */
export function selectMeasures(list, profile) {
  const names = list ? list.split(',').map(name => name.trim()).filter(Boolean) : MEASURES;
  for (const name of names) {
    if (!MEASURES.includes(name)) {
      throw new Error(`Unknown measure: ${name}; one of ${MEASURES.join(', ')}`);
    }
  }
  return MEASURES.filter(name => names.includes(name) && (SCREEN_OPERATIONS[name].profiles?.includes(profile) ?? true));
}

/**
 * The browser's state for a session: the refresh token's cookie, and the
 * auth token and expiry times in `localStorage` under the web client's key
 * (LG-40), as `browser.newContext({ storageState })` takes it.
 */
export function sessionState(origin, cookies, login) {
  return {
    cookies,
    origins: [
      {
        origin,
        localStorage: [
          {
            name: AUTH_KEY,
            value: JSON.stringify({
              authToken: login.authToken,
              authTokenExpiresAt: login.authTokenExpiresAt,
              refreshTokenExpiresAt: login.refreshTokenExpiresAt
            })
          }
        ]
      }
    ]
  };
}

/**
 * Whether the auth token stored in `state` expires within `marginMs` of
 * `now`; a state without a readable expiry counts as expiring.
 */
export function expiresSoon(state, now, marginMs) {
  const item = state.origins.flatMap(origin => origin.localStorage).find(entry => entry.name === AUTH_KEY);
  let expiresAt = Number.NaN;
  try {
    expiresAt = Date.parse(JSON.parse(item?.value ?? '{}').authTokenExpiresAt);
  } catch {
    // Counts as expiring.
  }
  return Number.isNaN(expiresAt) || expiresAt - now < marginMs;
}

/**
 * A context's state with only the session kept: what the web client
 * remembers per device, such as the expanded folders (FB-14) or the view
 * mode, would make the next run start elsewhere.
 */
export function sessionOnly(state) {
  return {
    cookies: state.cookies,
    origins: state.origins.map(origin => ({
      origin: origin.origin,
      localStorage: origin.localStorage.filter(item => item.name === AUTH_KEY)
    }))
  };
}

/**
 * The 200 KB file of the preview measure: many short blocks, as a real file
 * has, so that typing re-renders only the last one (A-8.12).
 */
export function previewMarkdown(bytes = 200 * 1024) {
  return markdownOf(bytes, 'Preview');
}

/**
 * The remote `<name>.git` under `work/remotes`: a folder `many/` of 1,000
 * small Markdown files, a 100 KB `big.md` and a 200 KB `preview.md`.
 */
export function createScreenRemote(work, name) {
  const remotesDir = join(work, 'remotes');
  const bare = join(remotesDir, `${name}.git`);
  if (existsSync(bare)) {
    throw new Error(`${bare} exists already: pick another --name, or delete it.`);
  }
  mkdirSync(remotesDir, { recursive: true });
  const seed = join(work, 'clones', name, 'seed');
  mkdirSync(join(seed, FOLDER), { recursive: true });
  git(remotesDir, 'init', '-q', '--bare', '-b', 'main', bare);
  git(seed, 'init', '-q', '-b', 'main');
  for (let i = 1; i <= FOLDER_ENTRIES; i++) {
    const n = String(i).padStart(4, '0');
    writeFileSync(join(seed, FOLDER, `note-${n}.md`), `# Note ${n}\n\nA short note.\n`);
  }
  writeFileSync(join(seed, EDITOR_FILE), markdownOf(100 * 1024));
  writeFileSync(join(seed, PREVIEW_FILE), previewMarkdown());
  git(seed, 'add', '-A');
  git(seed, 'commit', '-q', '-m', 'Fixtures for perf-screen');
  git(seed, 'push', '-q', bare, 'main');
  return bare;
}

// ---------------------------------------------------------------------------
// The browser.

/**
 * Runs in every page before the web client: records when each click and key
 * press happened, and the time of each `fb:preview-updated` mark whose render
 * shows `__fbInput.expect`, checked as the mark is set.
 */
function recordInput() {
  const input = { clicks: [], keys: [], previewSeen: [], expect: null };
  window.__fbInput = input;
  addEventListener('click', event => input.clicks.push(event.timeStamp), true);
  addEventListener('keydown', event => input.keys.push(event.timeStamp), true);
  const mark = performance.mark.bind(performance);
  performance.mark = (name, options) => {
    const entry = mark(name, options);
    if (name === 'fb:preview-updated' && input.expect !== null) {
      const text = document.querySelector('md-preview .blocks')?.textContent ?? '';
      if (text.includes(input.expect)) {
        input.previewSeen.push(entry.startTime);
      }
    }
    return entry;
  };
}

/** One browser for the run, and the session that each fresh context starts with. */
export class ScreenBrowser {
  constructor({ url, profile }) {
    this.url = url.replace(/\/$/, '');
    this.profile = PROFILES[profile];
  }

  async start(email, password) {
    const { chromium, devices } = await import('playwright');
    this.device = devices[this.profile.device];
    this.browser = await chromium.launch();
    // One login for the whole run: logins are limited per address (NF-11.4).
    const context = await this.browser.newContext();
    try {
      const response = await context.request.post(`${this.url}/api/v1/auth/login`, {
        data: { email, password, refreshTokenDelivery: 'cookie' }
      });
      if (!response.ok()) {
        throw new Error(`Login as ${email} failed: ${response.status()} ${await response.text()}`);
      }
      const { cookies } = await context.storageState();
      this.state = sessionState(new URL(this.url).origin, cookies, await response.json());
    } finally {
      await context.close();
    }
  }

  /**
   * Refreshes the session from the tool, before a context starts, when its
   * auth token expires within {@link RENEW_MARGIN_MS}: the web client then
   * never refreshes during a run, whose new cookie could arrive after the
   * context's state was read and leave the next one a spent refresh token.
   */
  async renewIfDue() {
    if (!expiresSoon(this.state, Date.now(), RENEW_MARGIN_MS)) {
      return;
    }
    const context = await this.browser.newContext({ storageState: this.state });
    try {
      // A cookie-based refresh carries REFRESH_HEADER (`shared/contracts`) and no other site's Origin (LG-33).
      const response = await context.request.post(`${this.url}/api/v1/auth/session/refresh`, {
        data: {},
        headers: { 'X-Front-Burner-Refresh': '1', origin: new URL(this.url).origin }
      });
      if (!response.ok()) {
        throw new Error(`Refreshing the session failed: ${response.status()} ${await response.text()}`);
      }
      const { cookies } = await context.storageState();
      this.state = sessionState(new URL(this.url).origin, cookies, await response.json());
    } finally {
      await context.close();
    }
  }

  async close() {
    await this.browser?.close();
  }

  /**
   * Runs `measure(page)` in a fresh context, with an empty cache, and keeps
   * the session it ends with: a refresh replaces the refresh token, and the
   * old one used again would end the session.
   */
  async fresh(measure) {
    await this.renewIfDue();
    const context = await this.browser.newContext({ ...this.device, baseURL: this.url, storageState: this.state });
    try {
      await context.addInitScript(recordInput);
      const page = await context.newPage();
      const result = await measure(page);
      this.state = sessionOnly(await context.storageState());
      return result;
    } finally {
      await context.close();
    }
  }

  /** Throttles the page's network (`'slow-4g'` or `'none'`) and its CPU as the profile says. */
  async throttle(page, network) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    if (network === 'slow-4g') {
      await cdp.send('Network.emulateNetworkConditions', SLOW_4G);
    }
    if (this.profile.cpuRate > 1) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: this.profile.cpuRate });
    }
    return cdp;
  }

  async press(locator) {
    await (this.device.hasTouch ? locator.tap() : locator.click());
  }

  /** The `startTime` of the first mark `name` at or after `after`, with the folder for the tree's. */
  async waitForMark(page, name, { after = 0, folder } = {}) {
    try {
      const handle = await page.waitForFunction(
        ({ name, after, folder }) => {
          const found = performance.getEntriesByName(name, 'mark').find(mark =>
            mark.startTime >= after && (folder === undefined || mark.detail?.folder === folder)
          );
          return found ? found.startTime : null;
        },
        { name, after, folder },
        { timeout: MARK_WAIT_MS, polling: 20 }
      );
      return await handle.jsonValue();
    } catch (error) {
      throw await this.explain(page, error, `${name}${folder === undefined ? '' : ` of "${folder}"`}`);
    }
  }

  /** The error with what the page shows: its address and the marks set so far. */
  async explain(page, error, waitedFor) {
    const marks = await page.evaluate(() =>
      performance.getEntriesByType('mark').filter(mark => mark.name.startsWith('fb:')).map(mark =>
        `${mark.name}${mark.detail?.folder === undefined ? '' : `(${mark.detail.folder})`}@${
          Math.round(mark.startTime)
        }`
      )
    ).catch(() => []);
    return new Error(
      `Waiting for ${waitedFor} on ${page.url()}: ${error.message.split('\n')[0]} Marks so far: ${
        marks.join(', ') || 'none'
      }`
    );
  }

  async lastInput(page, kind) {
    const times = await page.evaluate(kind => window.__fbInput[kind], kind);
    if (times.length === 0) {
      throw new Error(`No ${kind} was recorded`);
    }
    return times.at(-1);
  }

  /** Fails when the page is the login page: the session was lost. */
  assertLoggedIn(page) {
    if (new URL(page.url()).pathname === '/login') {
      throw new Error('The browser was sent to the login page: the session ended.');
    }
  }

  /** Opens the repository screen with the file tree shown and its root listed. */
  async openScreen(page, repositoryId, path) {
    await page.goto(path ? `/repositories/${repositoryId}/files/${path}` : `/repositories/${repositoryId}`);
    this.assertLoggedIn(page);
    const files = page.getByRole('toolbar', { name: 'Tool windows' }).getByRole('button', {
      name: 'Files',
      exact: true
    });
    if (path) {
      return;
    }
    // Beside the editor on wide screens, a drawer on phones (FB-9).
    await files.waitFor({ timeout: MARK_WAIT_MS });
    if (await files.getAttribute('aria-pressed') === 'false') {
      await this.press(files);
    }
    await page.getByRole('region', { name: 'Files', exact: true }).waitFor({ timeout: MARK_WAIT_MS });
    await this.waitForMark(page, 'fb:tree-folder-shown', { folder: '' });
  }

  entry(page, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return page.getByRole('tree', { name: 'Files' }).getByRole('treeitem', { name: new RegExp(`^${escaped},`) });
  }

  /** NF-2.7: from the navigation to `fb:app-ready`, cold, then warm after a reload. */
  firstLoad() {
    return this.fresh(async page => {
      await this.throttle(page, SCREEN_OPERATIONS['first-load'].network);
      await page.goto('/', { waitUntil: 'commit' });
      const cold = await this.waitForMark(page, 'fb:app-ready');
      this.assertLoggedIn(page);
      await page.reload({ waitUntil: 'commit' });
      const warm = await this.waitForMark(page, 'fb:app-ready');
      return { 'first-load': cold, 'first-load-warm': warm };
    });
  }

  /** NF-2.1: from the click on `many/` to its first entries on the page. */
  folder(repositoryId) {
    return this.fresh(async page => {
      await this.openScreen(page, repositoryId);
      await this.throttle(page, SCREEN_OPERATIONS.folder.network);
      await this.press(this.entry(page, FOLDER));
      const clicked = await this.lastInput(page, 'clicks');
      return (await this.waitForMark(page, 'fb:tree-folder-shown', { after: clicked, folder: FOLDER })) - clicked;
    });
  }

  /** NF-2.2: from the click on `big.md` to the editor taking input, its chunk not loaded yet. */
  editor(repositoryId, key) {
    return this.fresh(async page => {
      await this.openScreen(page, repositoryId);
      // The mark names no file, so no other file may be opening: the screen opened without one.
      if (await page.evaluate(() => performance.getEntriesByName('fb:editor-ready', 'mark').length > 0)) {
        throw new Error('The repository screen opened a file by itself, so the editor\'s mark cannot be told apart.');
      }
      await this.throttle(page, SCREEN_OPERATIONS[key].network);
      await this.press(this.entry(page, EDITOR_FILE));
      const clicked = await this.lastInput(page, 'clicks');
      return (await this.waitForMark(page, 'fb:editor-ready', { after: clicked })) - clicked;
    });
  }

  /**
   * NF-2.5: types a word at the end of `preview.md`, then times until a
   * render that shows it. On a desktop the preview is beside the editor, so
   * from the last key; on a phone it is the **Preview** tab, which does no
   * work while hidden (A-8.12), so from the tap on the tab.
   */
  preview(repositoryId, run) {
    return this.fresh(async page => {
      await this.openScreen(page, repositoryId, PREVIEW_FILE);
      await this.waitForMark(page, 'fb:editor-ready');
      const narrow = await page.getByRole('tab', { name: 'Preview', exact: true }).count() > 0;
      if (!narrow) {
        await this.waitForMark(page, 'fb:preview-updated');
      }
      const word = `perf${run}x`;
      await page.evaluate(word => (window.__fbInput.expect = word), word);
      await this.throttle(page, SCREEN_OPERATIONS.preview.network);
      const editor = page.getByRole('main', { name: 'Editor' }).getByRole('textbox', {
        name: PREVIEW_FILE,
        exact: true
      });
      await this.press(editor);
      await page.keyboard.press('ControlOrMeta+End');
      await page.keyboard.type(` ${word}`);
      let from = await this.lastInput(page, 'keys');
      if (narrow) {
        await this.press(page.getByRole('tab', { name: 'Preview', exact: true }));
        from = await this.lastInput(page, 'clicks');
      }
      // Only a render after `from` counts: on a phone, one before the tap would not be on screen.
      const seen = await page.waitForFunction(
        from => window.__fbInput.previewSeen.find(time => time >= from) ?? null,
        from,
        { timeout: MARK_WAIT_MS, polling: 20 }
      ).catch(async error => {
        throw await this.explain(page, error, `a render showing "${word}"`);
      });
      return (await seen.jsonValue()) - from;
    });
  }
}
