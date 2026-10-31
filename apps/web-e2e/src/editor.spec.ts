import AxeBuilder from '@axe-core/playwright';
import type { Browser, Locator, Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { drainFailedRequests, expect, type Monitor, test } from './support/fixtures';
import { logIn, seed, TEST_ADMIN } from './support/instance';

test.use({ instanceOptions: { onboarded: true } });

/** The administrator that onboarding created. */
const ADMIN_ID = 1;

const SAVED = 'Saved';
const SAVING = 'Saving…';
const OFFLINE = 'Not saved — offline, retrying';
const TOO_LARGE = 'Not saved — the file is larger than 1 MB';
const DRAFT_OFFER = /You have unsaved changes from /;
const LARGE_NOTE = 'Highlighting is off for large files on small screens, to keep typing fast.';
const NOT_SAVED = 'Not saved';
const UPDATED = 'This file was updated.';
const CHANGED = 'This file changed while you were editing.';
const GONE_ELSEWHERE = 'This file was deleted or renamed elsewhere.';

const filesButton = (page: Page) =>
  page.getByRole('toolbar', { name: 'Tool windows' }).getByRole('button', { name: 'Files', exact: true });
const tree = (page: Page) => page.getByRole('region', { name: 'Files', exact: true });
const main = (page: Page) => page.getByRole('main', { name: 'Editor' });
/** The editor, labelled with the open file's name (ED-37). */
const editor = (page: Page, name: string) => main(page).getByRole('textbox', { name, exact: true });
/** The save status in the bar (ED-18). */
const status = (page: Page) => page.getByRole('banner').getByRole('status');
const entry = (page: Page, name: string) =>
  page.getByRole('tree', { name: 'Files' }).getByRole('treeitem', {
    name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')},`)
  });
const dialog = (page: Page) => page.getByRole('dialog');
/** The toasts, without the live region that announces them. */
const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications' });

/** Seeds `handbook` and the files of `extra` in its working copy; returns its ID and its working copy. */
function seedHandbook(
  dataDir: string,
  extra: Record<string, string | Buffer> = {},
  others: string[] = []
): { id: number; dir: string; otherIds: number[]; } {
  const [ id, ...otherIds ] = seed(dataDir, {
    repositories: [
      { userId: ADMIN_ID, name: 'handbook', workingCopy: 'handbook' },
      ...others.map(name => ({ userId: ADMIN_ID, name, lastAccessedAt: new Date(Date.now() - 60_000) }))
    ]
  }).repositoryIds;
  const dir = join(dataDir, 'repos', String(ADMIN_ID), String(id));
  for (const [ path, content ] of Object.entries(extra)) {
    writeFileSync(join(dir, path), content);
  }
  return { id, dir, otherIds };
}

const onDisk = (dir: string, path: string) => readFileSync(join(dir, path), 'utf8');
const commitCount = (dir: string) =>
  execFileSync('git', [ 'rev-list', '--count', 'HEAD' ], { cwd: dir }).toString().trim();

/** A Markdown file of `size` bytes. */
function markdownOf(size: number): string {
  const line = 'Some words of a long file, to make it large enough.\n';
  const body = line.repeat(Math.ceil(size / line.length));
  return `# Large\n${body}`.slice(0, size - 1) + '\n';
}

/** Logs in on the way to `url` and waits for the repository to have opened. */
async function openScreen(page: Page, url: string): Promise<void> {
  const opened = page.waitForResponse(response => /\/api\/v1\/repositories\/\d+\/open$/.test(response.url()));
  await page.goto(url);
  await logIn(page);
  await opened;
}

async function press(page: Page, target: Locator, isMobile: boolean): Promise<void> {
  await (isMobile ? target.tap() : target.click());
}

async function showTree(page: Page): Promise<void> {
  if (await filesButton(page).getAttribute('aria-pressed') === 'false') {
    await filesButton(page).click();
  }
  await expect(tree(page)).toBeVisible();
}

/** Types `text` at the end of the open file `name`. */
async function typeAtEnd(page: Page, name: string, text: string): Promise<void> {
  await editor(page, name).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(text);
}

/** Makes every save of the repository fail as if the network were off; reading still works. */
async function failSaves(page: Page, repositoryId: number): Promise<void> {
  await page.route(
    `**/api/v1/repositories/${repositoryId}/file`,
    route => route.request().method() === 'PUT' ? route.abort('internetdisconnected') : route.fallback()
  );
}

/** The browser drafts in IndexedDB, by key (A-8.10). */
function storedDrafts(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() =>
    new Promise<Record<string, string>>((resolve, reject) => {
      const request = indexedDB.open('front-burner', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('drafts');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const drafts: Record<string, string> = {};
        const cursor = request.result.transaction('drafts').objectStore('drafts').openCursor();
        cursor.onerror = () => reject(cursor.error);
        cursor.onsuccess = () => {
          if (cursor.result) {
            drafts[String(cursor.result.key)] = (cursor.result.value as { content: string; }).content;
            cursor.result.continue();
          } else {
            request.result.close();
            resolve(drafts);
          }
        };
      };
    })
  );
}

/** Types an edit that cannot be saved, and waits until it is kept as a browser draft. */
async function typeUnsaved(page: Page, repositoryId: number, name: string, text: string): Promise<void> {
  await failSaves(page, repositoryId);
  await typeAtEnd(page, name, text);
  await expect(status(page)).toHaveText(OFFLINE, { timeout: 10_000 });
  await expect.poll(async () => Object.keys(await storedDrafts(page)).length).toBe(1);
}

/**
 * Opens `url` on a second device: another browser, logged in as the same
 * user, on a desktop. Closed with the returned function.
 */
async function otherDevice(
  browser: Browser,
  baseURL: string,
  url: string
): Promise<{ page: Page; close(): Promise<void>; }> {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await openScreen(page, url);
  return { page, close: () => context.close() };
}

/** Chooses `action` from the actions menu of the tree entry `name`. */
async function entryAction(page: Page, name: string, action: string, isMobile: boolean): Promise<void> {
  await showTree(page);
  await press(page, entry(page, name).getByRole('button', { name: `Actions for ${name}` }), isMobile);
  await press(page, page.getByRole('menuitem', { name: action, exact: true }), isMobile);
  await expect(dialog(page)).toBeVisible();
}

/** Selects the entry `name` in the tree, as a user opens a file. */
async function select(page: Page, name: string, isMobile: boolean): Promise<void> {
  await showTree(page);
  await press(page, entry(page, name), isMobile);
}

/** The console errors of saves and pushes that failed while offline or were refused, which the test expects. */
function drainSaves(monitor: Monitor, repositoryId: number): void {
  drainFailedRequests(monitor, `/api/v1/repositories/${repositoryId}/file`);
  // Checking a file deleted elsewhere (ED-21).
  drainFailedRequests(monitor, `/api/v1/repositories/${repositoryId}/file/state`);
  drainFailedRequests(monitor, '/api/v1/events');
}

test.describe('editor', () => {
  test('AC-EDIT-001.3: saves after typing stops without committing', async ({ page, instance }) => {
    const { id, dir } = seedHandbook(instance.dataDir);
    const commits = commitCount(dir);
    await openScreen(page, `/repositories/${id}/files/README.md`);
    await expect(status(page)).toHaveText(SAVED);

    await typeAtEnd(page, 'README.md', 'More words.');

    await expect(status(page)).toHaveText(SAVING);
    await expect(status(page)).toHaveText(SAVED);
    expect(onDisk(dir, 'README.md')).toBe('# Handbook\nMore words.');
    expect(commitCount(dir)).toBe(commits);
  });

  test('AC-EDIT-001.4: saves the first file when another is opened within 1.5 s', async ({ page, instance, isMobile }) => {
    const { id, dir } = seedHandbook(instance.dataDir);
    await openScreen(page, `/repositories/${id}/files/docs/guide.md`);

    await typeAtEnd(page, 'guide.md', 'Typed just before.');
    await select(page, 'README.md', isMobile);

    await expect(editor(page, 'README.md')).toBeVisible();
    await expect.poll(() => onDisk(dir, 'docs/guide.md')).toBe('# Guide\nTyped just before.');
  });

  test('AC-EDIT-001.5: saves after the network comes back', async ({ page, context, instance, monitor }) => {
    test.slow();
    const { id, dir } = seedHandbook(instance.dataDir);
    await openScreen(page, `/repositories/${id}/files/README.md`);
    await expect(editor(page, 'README.md')).toBeVisible();

    await context.setOffline(true);
    await typeAtEnd(page, 'README.md', 'Offline edit.');
    await expect(status(page)).toHaveText(OFFLINE, { timeout: 10_000 });
    await context.setOffline(false);

    await expect(status(page)).toHaveText(SAVED, { timeout: 30_000 });
    expect(onDisk(dir, 'README.md')).toBe('# Handbook\nOffline edit.');
    drainSaves(monitor, id);
  });

  test('AC-EDIT-001.10: shows the 1 MB refusal and saves again once smaller', async ({ page, instance, monitor }) => {
    const { id, dir } = seedHandbook(instance.dataDir, { 'big.md': markdownOf(1_048_000) });
    await openScreen(page, `/repositories/${id}/files/big.md`);
    await expect(editor(page, 'big.md')).toBeVisible();

    await editor(page, 'big.md').click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.insertText('a'.repeat(1000));
    await expect(status(page)).toHaveText(TOO_LARGE);

    await page.keyboard.press('ControlOrMeta+z');
    await page.keyboard.insertText('small');
    await expect(status(page)).toHaveText(SAVED);
    expect(onDisk(dir, 'big.md').endsWith('\nsmall')).toBe(true);
    drainSaves(monitor, id);
  });

  test('AC-EDIT-001.2: is ready to edit a 100 KB file within NF-2.2', async ({ page, instance, browserName, isMobile }) => {
    test.skip(isMobile, 'NF-2.2 is measured on desktop broadband and on slow 4G from a desktop browser');
    const { id } = seedHandbook(instance.dataDir, { 'hundred.md': markdownOf(100 * 1024) });

    // From a non-Markdown file, so that the editor's chunk is not loaded yet.
    await openScreen(page, `/repositories/${id}/files/logo.png`);
    let started = Date.now();
    await select(page, 'hundred.md', false);
    await expect(editor(page, 'hundred.md')).toBeEditable();
    expect(Date.now() - started).toBeLessThan(1000);

    if (browserName !== 'chromium') {
      return;
    }
    // Slow 4G, as Lighthouse throttles it, on a fresh page: the editor's chunk is loaded again.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await page.goto(`/repositories/${id}/files/logo.png`);
    await expect(entry(page, 'hundred.md')).toBeVisible();
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8
    });
    started = Date.now();
    await select(page, 'hundred.md', false);
    await expect(editor(page, 'hundred.md')).toBeEditable({ timeout: 10_000 });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test('AC-EDIT-001.22: opens find and replace from the button and Ctrl+F, and Esc then Tab leaves the editor', async ({ page, instance, isMobile, browserName }) => {
    const { id } = seedHandbook(instance.dataDir);
    await openScreen(page, `/repositories/${id}/files/README.md`);
    const search = main(page).getByRole('textbox', { name: 'Find' });

    await press(page, main(page).getByRole('button', { name: 'Find', exact: true }), isMobile);
    await expect(search).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(search).toBeHidden();

    if (isMobile) {
      return;
    }
    await editor(page, 'README.md').click();
    await page.keyboard.press('ControlOrMeta+f');
    await expect(search).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(editor(page, 'README.md')).toBeFocused();

    await page.keyboard.press('Escape');
    await page.keyboard.press('Tab');
    // The browser's own Tab, not the editor's: no tab is inserted.
    await expect(editor(page, 'README.md')).toHaveText(/^# Handbook$/);
    // The editor is the page's last focusable element: Chromium and WebKit move the focus past it to the
    // page, while Firefox keeps it there (with an element after the editor, Firefox moves to it too).
    if (browserName !== 'firefox') {
      await expect(editor(page, 'README.md')).not.toBeFocused();
    }
  });

  test('NF-13.5: resizes the editor and the preview with the arrow keys on the line between them', async ({ page, instance, isMobile }) => {
    test.skip(isMobile, 'a phone shows the Edit and Preview tabs instead');
    const { id } = seedHandbook(instance.dataDir);
    await openScreen(page, `/repositories/${id}/files/README.md`);
    const separator = main(page).getByRole('separator', { name: 'Resize the preview' });
    const width = async () => (await editor(page, 'README.md').boundingBox())!.width;

    const before = await width();
    await separator.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');

    await expect.poll(width).toBeGreaterThan(before);
  });

  test('AC-EDIT-001.25: opens a large file without highlighting on a phone, and highlighted on a desktop', async ({ page, instance, isMobile }) => {
    const { id } = seedHandbook(instance.dataDir, {
      'large.md': markdownOf(150 * 1024),
      'medium.md': markdownOf(50 * 1024)
    });
    const note = () => main(page).getByText(LARGE_NOTE);
    const headingToken = () => main(page).locator('.cm-content .tok-heading').first();
    await openScreen(page, `/repositories/${id}/files/large.md`);
    await expect(editor(page, 'large.md')).toBeVisible();

    if (!isMobile) {
      await expect(note()).toHaveCount(0);
      await expect(headingToken()).toBeVisible();
      return;
    }
    await expect(note()).toBeVisible();
    await expect(headingToken()).toHaveCount(0);

    await main(page).getByRole('button', { name: 'Turn on highlighting' }).tap();
    await expect(note()).toHaveCount(0);
    await expect(headingToken()).toBeVisible();

    await select(page, 'medium.md', isMobile);
    await expect(editor(page, 'medium.md')).toBeVisible();
    await expect(note()).toHaveCount(0);
    await expect(headingToken()).toBeVisible();

    await select(page, 'large.md', isMobile);
    await expect(editor(page, 'large.md')).toBeVisible();
    await expect(note()).toBeVisible();
  });

  test('AC-FILE-001.10: says why a file too large or not UTF-8 cannot be opened', async ({ page, instance, monitor, isMobile }) => {
    const { id } = seedHandbook(instance.dataDir, {
      'huge.md': markdownOf(2 * 1024 * 1024),
      'latin1.md': Buffer.from('# Caf\xe9 cr\xe8me\n', 'latin1')
    });
    await openScreen(page, `/repositories/${id}/files/huge.md`);

    await expect(main(page).getByText('This file is too large to edit (the limit is 1 MB).')).toBeVisible();
    await expect(main(page).getByRole('textbox')).toHaveCount(0);

    await select(page, 'latin1.md', isMobile);
    await expect(main(page).getByText('This file isn\'t UTF-8 text, so it can\'t be edited safely.')).toBeVisible();
    drainFailedRequests(monitor, `/api/v1/repositories/${id}/file`);
  });

  test('AC-FILE-001.17: keeps an edit typed just before renaming the open file', async ({ page, instance, isMobile }) => {
    const { id, dir } = seedHandbook(instance.dataDir);
    await openScreen(page, `/repositories/${id}/files/docs/guide.md`);

    await typeAtEnd(page, 'guide.md', 'Typed just before.');
    await showTree(page);
    await press(page, entry(page, 'guide.md').getByRole('button', { name: 'Actions for guide.md' }), isMobile);
    await press(page, page.getByRole('menuitem', { name: 'Rename', exact: true }), isMobile);
    await dialog(page).getByRole('textbox', { name: 'Name' }).fill('intro');
    await press(page, dialog(page).getByRole('button', { name: 'Rename', exact: true }), isMobile);

    await expect(page).toHaveURL(new RegExp(`/repositories/${id}/files/docs/intro.md$`));
    // On a phone the drawer stays open after a rename, over the editor.
    await expect(page.locator('main .cm-content')).toHaveAttribute('aria-label', 'intro.md');
    expect(onDisk(dir, 'docs/intro.md')).toBe('# Guide\nTyped just before.');
    expect(existsSync(join(dir, 'docs/guide.md'))).toBe(false);
  });

  test('AC-APP-001.6: saves an edit typed just before switching repositories', async ({ page, instance, isMobile }) => {
    const { id, dir, otherIds } = seedHandbook(instance.dataDir, {}, [ 'notes' ]);
    await openScreen(page, `/repositories/${id}/files/README.md`);

    await typeAtEnd(page, 'README.md', 'Typed just before.');
    const loaded = page.waitForResponse(response => response.url().includes('/api/v1/repositories/recent?exclude='));
    await press(page, page.getByRole('banner').getByRole('heading').getByRole('button'), isMobile);
    await loaded;
    await press(page, page.getByRole('menuitem', { name: 'notes' }), isMobile);

    await expect(page).toHaveURL(new RegExp(`/repositories/${otherIds[0]}$`));
    await expect.poll(() => onDisk(dir, 'README.md')).toBe('# Handbook\nTyped just before.');
  });

  test('AC-APP-001.9: puts a dot in the title while an edit is unsaved', async ({ page, instance }) => {
    const { id } = seedHandbook(instance.dataDir);
    await openScreen(page, `/repositories/${id}/files/README.md`);
    await expect(page).toHaveTitle('README.md · handbook · Front Burner');

    await typeAtEnd(page, 'README.md', '!');

    await expect(page).toHaveTitle('• README.md · handbook · Front Burner');
    await expect(page).toHaveTitle('README.md · handbook · Front Burner');
  });

  test('has no axe violations with a file open', async ({ page, instance, isMobile }) => {
    const { id } = seedHandbook(instance.dataDir);
    await openScreen(page, `/repositories/${id}/files/README.md`);
    await expect(editor(page, 'README.md')).toBeVisible();
    await expect(status(page)).toHaveText(SAVED);

    const results = await new AxeBuilder({ page }).exclude('ui-split-pane > .divider').analyze();

    expect(results.violations).toEqual([]);
    expect(isMobile || await main(page).isVisible()).toBe(true);
  });

  test.describe('browser drafts', () => {
    test('AC-EDIT-001.6: offers an offline edit after a reload and restores it', async ({ page, instance, monitor }) => {
      const { id, dir } = seedHandbook(instance.dataDir);
      await openScreen(page, `/repositories/${id}/files/README.md`);
      await typeUnsaved(page, id, 'README.md', 'Offline edit.');

      // The browser asks before the reload, since the edit is unsaved (ED-22).
      page.once('dialog', dialog => void dialog.accept());
      await page.reload();

      const offer = main(page).getByText(DRAFT_OFFER);
      await expect(offer).toBeVisible();
      await page.unroute(`**/api/v1/repositories/${id}/file`);
      await expect(editor(page, 'README.md')).toHaveText('# Handbook');
      await expect(editor(page, 'README.md')).toHaveAttribute('contenteditable', 'false');
      await main(page).getByRole('button', { name: 'Restore', exact: true }).click();

      await expect(offer).toBeHidden();
      await expect(editor(page, 'README.md')).toContainText('Offline edit.');
      await expect(status(page)).toHaveText(SAVED);
      expect(onDisk(dir, 'README.md')).toBe('# Handbook\nOffline edit.');
      await expect.poll(() => storedDrafts(page)).toEqual({});
      drainSaves(monitor, id);
    });

    test('AC-EDIT-001.7: deletes drafts on logout', async ({ page, instance, monitor }) => {
      const { id } = seedHandbook(instance.dataDir);
      await openScreen(page, `/repositories/${id}/files/README.md`);
      await typeUnsaved(page, id, 'README.md', 'Unsaved.');

      page.once('dialog', dialog => void dialog.accept());
      await page.getByRole('button', { name: /^Account menu for / }).click();
      await page.getByRole('menuitem', { name: 'Log out' }).click();

      await expect(page.getByRole('heading', { level: 1, name: 'Log in' })).toBeVisible();
      await expect.poll(() => storedDrafts(page)).toEqual({});
      drainSaves(monitor, id);
    });

    test('AC-EDIT-001.8: asks before closing a tab with unsaved edits', async ({ page, instance, monitor }) => {
      const { id } = seedHandbook(instance.dataDir);
      await openScreen(page, `/repositories/${id}/files/README.md`);
      await typeUnsaved(page, id, 'README.md', 'Unsaved.');

      const asked = page.waitForEvent('dialog');
      await page.close({ runBeforeUnload: true });
      const dialog = await asked;

      expect(dialog.type()).toBe('beforeunload');
      await dialog.dismiss();
      expect(page.isClosed()).toBe(false);
      drainSaves(monitor, id);
    });

    test('AC-APP-001.3: deletes browser drafts when logging out, in every tab', async ({ page, context, instance, monitor }) => {
      const { id } = seedHandbook(instance.dataDir);
      await openScreen(page, `/repositories/${id}/files/README.md`);
      await typeUnsaved(page, id, 'README.md', 'Unsaved.');
      const other = await context.newPage();
      await other.goto('/');
      await expect(other.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();

      await other.getByRole('button', { name: /^Account menu for / }).click();
      const menu = other.getByRole('menu');
      await expect(menu).toContainText(TEST_ADMIN.displayName);
      await expect(menu).toContainText(TEST_ADMIN.email);
      await expect(menu.getByRole('menuitem', { name: 'Log out' })).toBeVisible();
      await menu.getByRole('menuitem', { name: 'Log out' }).click();

      await expect(other.getByRole('heading', { level: 1, name: 'Log in' })).toBeVisible();
      await expect(page.getByRole('heading', { level: 1, name: 'Log in' })).toBeVisible();
      await expect.poll(() => storedDrafts(page)).toEqual({});
      drainSaves(monitor, id);
    });

    test('has no axe violations with the offer shown', async ({ page, instance, monitor }) => {
      const { id } = seedHandbook(instance.dataDir);
      await openScreen(page, `/repositories/${id}/files/README.md`);
      await typeUnsaved(page, id, 'README.md', 'Unsaved.');
      page.once('dialog', dialog => void dialog.accept());
      await page.reload();
      await expect(main(page).getByText(DRAFT_OFFER)).toBeVisible();

      const results = await new AxeBuilder({ page }).exclude('ui-split-pane > .divider').analyze();

      expect(results.violations).toEqual([]);
      drainSaves(monitor, id);
    });
  });

  test.describe('changes on disk', () => {
    test('AC-EDIT-001.12: updates the editor after a change elsewhere, and asks with unsaved edits', async ({ page, browser, instance, monitor }) => {
      const { id, dir } = seedHandbook(instance.dataDir);
      await openScreen(page, `/repositories/${id}/files/README.md`);
      await expect(editor(page, 'README.md')).toHaveText('# Handbook');
      const other = await otherDevice(browser, instance.url, `/repositories/${id}/files/README.md`);
      try {
        // No unsaved edits: the editor follows.
        await typeAtEnd(other.page, 'README.md', 'Theirs.');
        await expect(status(other.page)).toHaveText(SAVED);
        await expect(toasts(page).getByText(UPDATED)).toBeVisible();
        await expect(editor(page, 'README.md')).toContainText('Theirs.');

        // Unsaved edits, then Keep mine.
        await typeUnsaved(page, id, 'README.md', ' Mine.');
        await typeAtEnd(other.page, 'README.md', ' Again.');
        await expect(status(other.page)).toHaveText(SAVED);
        await expect(main(page).getByText(CHANGED)).toBeVisible();
        await expect(status(page)).toHaveText(NOT_SAVED);
        await expect(editor(page, 'README.md')).toContainText('Mine.');
        const results = await new AxeBuilder({ page }).exclude('ui-split-pane > .divider').analyze();
        expect(results.violations).toEqual([]);
        await page.unroute(`**/api/v1/repositories/${id}/file`);
        await main(page).getByRole('button', { name: 'Keep mine', exact: true }).click();
        await expect(main(page).getByText(CHANGED)).toBeHidden();
        await expect(status(page)).toHaveText(SAVED);
        expect(onDisk(dir, 'README.md')).toBe('# Handbook\nTheirs. Mine.');
        await expect.poll(() => storedDrafts(page)).toEqual({});

        // Unsaved edits, then Reload.
        await typeUnsaved(page, id, 'README.md', ' Lost.');
        await other.page.reload();
        await typeAtEnd(other.page, 'README.md', ' Kept.');
        await expect(status(other.page)).toHaveText(SAVED);
        await expect(main(page).getByText(CHANGED)).toBeVisible();
        await main(page).getByRole('button', { name: 'Reload', exact: true }).click();
        await expect(main(page).getByText(CHANGED)).toBeHidden();
        await expect(editor(page, 'README.md')).toHaveText('# HandbookTheirs. Mine. Kept.');
        await expect(status(page)).toHaveText(SAVED);
        await expect.poll(() => storedDrafts(page)).toEqual({});
        await page.unroute(`**/api/v1/repositories/${id}/file`);
        expect(onDisk(dir, 'README.md')).toBe('# Handbook\nTheirs. Mine. Kept.');
      } finally {
        await other.close();
      }
      drainSaves(monitor, id);
    });

    test('never shows either notice for the user\'s own saves', async ({ page, instance }) => {
      const { id, dir } = seedHandbook(instance.dataDir);
      await openScreen(page, `/repositories/${id}/files/README.md`);
      await expect(status(page)).toHaveText(SAVED);

      // Over 10 s of typing, with a save after every word, each event coming
      // back while the next word is typed.
      for (let word = 0; word < 8; word++) {
        await typeAtEnd(page, 'README.md', ` word${word}`);
        await expect(status(page)).toHaveText(SAVING);
        await expect(status(page)).toHaveText(SAVED);
      }

      // A notice would still be shown: the toast stays for 6 s, the question until answered.
      await expect(toasts(page).getByText(UPDATED)).toHaveCount(0);
      await expect(main(page).getByText(CHANGED)).toHaveCount(0);
      expect(onDisk(dir, 'README.md')).toBe(
        `# Handbook\n${[ 0, 1, 2, 3, 4, 5, 6, 7 ].map(word => ` word${word}`).join('')}`
      );
    });

    test('AC-EDIT-001.11: offers Recreate it after the file was deleted on another device', async ({ page, browser, instance, monitor, isMobile }) => {
      const { id, dir } = seedHandbook(instance.dataDir);
      // No events reach this device, so that the next save finds the file gone.
      await page.route('**/api/v1/events**', route => route.abort('internetdisconnected'));
      await openScreen(page, `/repositories/${id}/files/docs/guide.md`);
      await expect(editor(page, 'guide.md')).toHaveText('# Guide');
      const other = await otherDevice(browser, instance.url, `/repositories/${id}/files/docs/guide.md`);
      try {
        await entryAction(other.page, 'guide.md', 'Delete', false);
        await other.page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
        await expect(other.page.getByRole('dialog')).toBeHidden();
      } finally {
        await other.close();
      }
      expect(existsSync(join(dir, 'docs/guide.md'))).toBe(false);

      await typeAtEnd(page, 'guide.md', 'Mine.');

      await expect(main(page).getByText(GONE_ELSEWHERE)).toBeVisible();
      await expect(status(page)).toHaveText(NOT_SAVED);
      await expect(editor(page, 'guide.md')).toHaveAttribute('contenteditable', 'false');
      await press(page, main(page).getByRole('button', { name: 'Recreate it', exact: true }), isMobile);

      await expect(main(page).getByText(GONE_ELSEWHERE)).toBeHidden();
      await expect(status(page)).toHaveText(SAVED);
      expect(onDisk(dir, 'docs/guide.md')).toBe('# Guide\nMine.');
      await expect(editor(page, 'guide.md')).toHaveAttribute('contenteditable', 'true');
      drainSaves(monitor, id);
    });

    test('AC-FILE-001.21: keeps unsaved edits of a file deleted on another device and offers Recreate it', async ({ page, browser, instance, monitor, isMobile }) => {
      const { id, dir } = seedHandbook(instance.dataDir);
      await openScreen(page, `/repositories/${id}/files/docs/guide.md`);
      await typeUnsaved(page, id, 'guide.md', 'Mine.');
      const other = await otherDevice(browser, instance.url, `/repositories/${id}/files/docs/guide.md`);
      try {
        await entryAction(other.page, 'guide.md', 'Delete', false);
        await other.page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
        await expect(other.page.getByRole('dialog')).toBeHidden();
      } finally {
        await other.close();
      }

      await expect(main(page).getByText(GONE_ELSEWHERE)).toBeVisible();
      await expect(editor(page, 'guide.md')).toHaveText('# GuideMine.');
      await expect(editor(page, 'guide.md')).toHaveAttribute('contenteditable', 'false');
      await expect(status(page)).toHaveText(NOT_SAVED);
      expect(Object.values(await storedDrafts(page))).toEqual([ '# Guide\nMine.' ]);
      const results = await new AxeBuilder({ page }).exclude('ui-split-pane > .divider').analyze();
      expect(results.violations).toEqual([]);

      await page.unroute(`**/api/v1/repositories/${id}/file`);
      await press(page, main(page).getByRole('button', { name: 'Recreate it', exact: true }), isMobile);

      await expect(main(page).getByText(GONE_ELSEWHERE)).toBeHidden();
      await expect(status(page)).toHaveText(SAVED);
      expect(onDisk(dir, 'docs/guide.md')).toBe('# Guide\nMine.');
      await expect.poll(() => storedDrafts(page)).toEqual({});
      await showTree(page);
      await expect(entry(page, 'guide.md')).toBeVisible();
      drainSaves(monitor, id);
    });
  });
});
