import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { drainFailedRequests, expect, test } from './support/fixtures';
import { logIn, seed, type SeedRepository } from './support/instance';

test.use({ instanceOptions: { onboarded: true } });

/** The administrator that onboarding created. */
const ADMIN_ID = 1;

const heading = (page: Page, name: string) => page.getByRole('heading', { name, exact: true });
const filesButton = (page: Page) => page.getByRole('banner').getByRole('button', { name: 'Files', exact: true });
const tree = (page: Page) => page.getByRole('region', { name: 'Files', exact: true });
const editor = (page: Page) => page.getByRole('main', { name: 'Editor' });
const separator = (page: Page) => page.getByRole('separator', { name: 'Resize file tree' });
/** A row of the file tree, by the name its accessible name starts with (FB-46). */
const entry = (page: Page, name: string) =>
  page.getByRole('tree', { name: 'Files' }).getByRole('treeitem', {
    name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')},`)
  });
const ignoredIcon = (page: Page, name: string) => entry(page, name).locator('.ignored-icon');
const tooltip = (page: Page) => page.locator('ui-tooltip');
const LATER = 'The editor comes in a later version.';
const IGNORED_FILE = 'Ignored by .gitignore. Git won\'t commit this file.';
const IGNORED_FOLDER = 'Ignored by .gitignore. Git won\'t commit anything in this folder.';

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

function seedRepositories(dataDir: string, repositories: Omit<SeedRepository, 'userId'>[]): number[] {
  return seed(dataDir, { repositories: repositories.map(repository => ({ userId: ADMIN_ID, ...repository })) })
    .repositoryIds;
}

/** Logs in on the way to `url` and waits for the repository to have opened. */
async function openScreen(page: Page, url: string): Promise<void> {
  const opened = page.waitForResponse(response => /\/api\/v1\/repositories\/\d+\/open$/.test(response.url()));
  await page.goto(url);
  await logIn(page);
  await opened;
}

/** Shows the file tree: it is beside the editor on wide screens, and a drawer on phones (FB-9). */
async function showTree(page: Page): Promise<void> {
  if (await filesButton(page).getAttribute('aria-expanded') === 'false') {
    await filesButton(page).click();
  }
  await expect(tree(page)).toBeVisible();
}

/** Shows the message of an entry's ignored icon: by hover on desktops, by tap on phones (FB-20a). */
async function explainIgnored(page: Page, name: string, isMobile: boolean): Promise<void> {
  if (isMobile) {
    await ignoredIcon(page, name).tap();
  } else {
    await ignoredIcon(page, name).hover();
  }
}

/** Closes the drawer of a phone, which stays open after an action, over the editor area. */
async function hideTreeOnPhone(page: Page, isMobile: boolean): Promise<void> {
  if (isMobile && await filesButton(page).getAttribute('aria-expanded') === 'true') {
    await filesButton(page).tap();
  }
}

/** On a phone, opening a file closes the drawer (FB-9). */
async function drawerClosedOnPhone(page: Page, isMobile: boolean): Promise<void> {
  if (isMobile) {
    await expect(tree(page)).toBeHidden();
  }
}

/** Points the tree's active row, by `aria-activedescendant`, at the entry. */
async function expectActive(page: Page, name: string): Promise<void> {
  await expect(page.getByRole('tree', { name: 'Files' })).toHaveAttribute(
    'aria-activedescendant',
    await entry(page, name).getAttribute('id') ?? `no row ${name}`
  );
}

/** Axe on the repository screen; on a phone the open drawer is shown instead of `main` (FB-9). */
function axe(page: Page, isMobile: boolean): AxeBuilder {
  const builder = new AxeBuilder({ page }).exclude('ui-split-pane > .divider');
  return isMobile ? builder.disableRules('landmark-one-main') : builder;
}

const dialog = (page: Page) => page.getByRole('dialog');
const nameField = (page: Page) => dialog(page).getByRole('textbox', { name: 'Name' });
const IGNORED_NEW_FILE = 'This file matches a .gitignore rule, so git won\'t commit it.';
const EMPTY_FOLDER = 'Empty folders aren\'t saved in git. Add a file to keep this folder.';
const NAME_TAKEN = 'There is already a file or folder with this name here.';
const EMPTY_STATE = 'Choose a file from the tree, or create one';
const UNCOMMITTED_FILE = 'This file isn\'t committed, so it can\'t be recovered.';

/** Clicks, or taps on a phone. */
async function press(page: Page, target: Locator, isMobile: boolean): Promise<void> {
  await (isMobile ? target.tap() : target.click());
}

/** **New file** or **New folder** above the tree, in the root folder (FB-25). */
async function createInRoot(page: Page, kind: 'New file' | 'New folder', isMobile: boolean): Promise<void> {
  await showTree(page);
  await press(page, tree(page).getByRole('button', { name: kind, exact: true }), isMobile);
  await expect(dialog(page)).toBeVisible();
}

/** Chooses `action` in the actions menu of the entry `name` (FB-24). */
async function entryAction(page: Page, name: string, action: string, isMobile: boolean): Promise<void> {
  await showTree(page);
  await press(page, entry(page, name).getByRole('button', { name: `Actions for ${name}` }), isMobile);
  await press(page, page.getByRole('menuitem', { name: action, exact: true }), isMobile);
  await expect(dialog(page)).toBeVisible();
}

/** Confirms the open dialog with its `label` button. */
async function confirmDialog(page: Page, label: string, isMobile: boolean): Promise<void> {
  await press(page, dialog(page).last().getByRole('button', { name: label, exact: true }), isMobile);
}

function fitsWidth(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

test.describe('repository screen', () => {
  test('AC-FILE-001.1: opens a repository from the dashboard and moves it to the top', async ({ page, instance }) => {
    const [ handbook ] = seedRepositories(instance.dataDir, [
      { name: 'handbook', lastAccessedAt: minutesAgo(60) },
      { name: 'guides', lastAccessedAt: minutesAgo(5) }
    ]);
    const loaded = page.waitForResponse('**/api/v1/repositories/recent');
    await page.goto('/');
    await logIn(page);
    await loaded;
    const names = page.getByRole('list').getByRole('link', { name: /^(handbook|guides)$/ });
    await expect(names).toHaveText([ 'guides', 'handbook' ]);

    await page.getByRole('link', { name: 'handbook', exact: true }).click();

    await expect(page).toHaveURL(new RegExp(`/repositories/${handbook}$`));
    await expect(page.getByRole('banner').getByRole('heading', { name: 'handbook' })).toBeVisible();
    await expect(page).toHaveTitle('handbook · Front Burner');
    // Announced once the repository has opened, not the dashboard's title (NV-18).
    await expect(page.locator('rs-repository-screen shell-route-announcer [aria-live]')).toHaveText(
      'handbook · Front Burner'
    );
    await expect(editor(page).getByText('Choose a file from the tree, or create one')).toBeVisible();
    await expect(filesButton(page)).toBeVisible();

    const reloaded = page.waitForResponse('**/api/v1/repositories/recent');
    await page.getByRole('banner').getByRole('link', { name: /Front Burner|Dashboard/ }).click();
    await reloaded;
    await expect(names).toHaveText([ 'handbook', 'guides' ]);
  });

  test('AC-FILE-001.3: shows a cloning repository\'s status and link', async ({ page, instance }) => {
    const [ cloning ] = seedRepositories(instance.dataDir, [ { name: 'cloning-one', status: 'cloning' } ]);
    await openScreen(page, `/repositories/${cloning}`);

    await expect(page.getByText('This repository is still being cloned.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Repository settings' })).toHaveAttribute(
      'href',
      `/repositories/${cloning}/settings`
    );
    await expect(tree(page)).toHaveCount(0);
    await expect(page.getByRole('banner').getByRole('heading', { name: 'cloning-one' })).toBeVisible();
  });

  test('AC-FILE-001.4: collapses, expands and resizes the tree with the keyboard', async ({ page, instance, isMobile }) => {
    test.skip(isMobile, 'the keyboard and the side-by-side panes are for desktop browsers');
    const [ handbook ] = seedRepositories(instance.dataDir, [ { name: 'handbook' } ]);
    await openScreen(page, `/repositories/${handbook}`);
    await expect(tree(page)).toBeVisible();

    await filesButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(tree(page)).toBeHidden();
    await expect(filesButton(page)).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Enter');
    await expect(tree(page)).toBeVisible();
    await expect(filesButton(page)).toHaveAttribute('aria-expanded', 'true');

    await separator(page).focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(separator(page)).toHaveAttribute('aria-valuenow', '30');

    // This device remembers the size and the collapsed tree (FB-8).
    await filesButton(page).click();
    await expect(filesButton(page)).toHaveAttribute('aria-expanded', 'false');
    await page.reload();
    await expect(heading(page, 'handbook')).toBeVisible();
    await expect(tree(page)).toBeHidden();
    await filesButton(page).click();
    await expect(separator(page)).toHaveAttribute('aria-valuenow', '30');
  });

  test('AC-FILE-001.4: opens the tree as a drawer on a phone', async ({ page, instance }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    const [ handbook ] = seedRepositories(instance.dataDir, [
      { name: 'a-repository-with-a-rather-long-name-for-a-phone' }
    ]);
    await openScreen(page, `/repositories/${handbook}`);

    await expect(filesButton(page)).toBeVisible();
    await expect(tree(page)).toBeHidden();
    await expect(editor(page)).toBeVisible();
    expect(await fitsWidth(page)).toBe(true);

    await filesButton(page).click();
    await expect(tree(page)).toBeVisible();
    await expect(filesButton(page)).toHaveAttribute('aria-expanded', 'true');
    expect(await fitsWidth(page)).toBe(true);

    await page.keyboard.press('Escape');
    await expect(tree(page)).toBeHidden();
  });

  test('AC-APP-001.7: shows Page not found for another user\'s repository', async ({ page, instance, monitor }) => {
    const { userIds } = seed(instance.dataDir, { users: [ { email: 'user@example.com' } ] });
    const { repositoryIds: [ theirs ] } = seed(instance.dataDir, {
      repositories: [ { userId: userIds[0], name: 'their-notes' } ]
    });
    await openScreen(page, `/repositories/${theirs}`);

    await expect(heading(page, 'This page doesn\'t exist.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to the dashboard' })).toBeVisible();
    await expect(page).toHaveTitle('Page not found · Front Burner');
    await expect(page.getByText('their-notes')).toHaveCount(0);

    // The refused open is logged on purpose (FB-2).
    drainFailedRequests(monitor, `/api/v1/repositories/${theirs}/open`);
  });

  test('has no axe violations', async ({ page, instance }) => {
    const [ handbook, cloning ] = seedRepositories(instance.dataDir, [
      { name: 'handbook' },
      { name: 'cloning-one', status: 'cloning' }
    ]);
    await openScreen(page, `/repositories/${handbook}`);
    await expect(heading(page, 'handbook')).toBeVisible();
    // `ui-split-pane` puts the separator between the tree's region and `main`,
    // outside both, which the best-practice `region` rule reports.
    expect((await new AxeBuilder({ page }).exclude('ui-split-pane > .divider').analyze()).violations).toEqual([]);

    const opened = page.waitForResponse(`**/api/v1/repositories/${cloning}/open`);
    await page.goto(`/repositories/${cloning}`);
    await opened;
    await expect(page.getByText('This repository is still being cloned.')).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
  test('AC-FILE-001.4: closes the drawer when a file is opened on a phone', async ({ page, instance }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    const [ handbook ] = seedRepositories(instance.dataDir, [ { name: 'handbook', workingCopy: 'handbook' } ]);
    await openScreen(page, `/repositories/${handbook}`);
    await expect(heading(page, 'README.md')).toBeVisible();

    await showTree(page);
    await entry(page, 'docs').click();
    await expect(entry(page, 'docs')).toHaveAttribute('aria-expanded', 'true');
    await expect(tree(page)).toBeVisible();
    await entry(page, 'guide.md').click();

    await expect(page).toHaveURL(new RegExp(`/repositories/${handbook}/files/docs/guide.md$`));
    await expect(tree(page)).toBeHidden();
    await expect(heading(page, 'guide.md')).toBeVisible();
  });

  test('AC-FILE-001.5: opens the README first and then the last file', async ({ page, instance }) => {
    const [ handbook, empty ] = seedRepositories(instance.dataDir, [
      { name: 'handbook', workingCopy: 'handbook' },
      { name: 'empty-one' }
    ]);
    await openScreen(page, `/repositories/${handbook}`);

    await expect(page).toHaveURL(new RegExp(`/repositories/${handbook}/files/README.md$`));
    await expect(editor(page).getByRole('heading', { name: 'README.md' })).toBeVisible();
    await expect(editor(page).getByText(LATER)).toBeVisible();
    await expect(page).toHaveTitle('README.md · handbook · Front Burner');

    await showTree(page);
    await entry(page, 'docs').click();
    await entry(page, 'guide.md').click();
    await expect(page).toHaveURL(/\/files\/docs\/guide.md$/);

    // Back to the dashboard and into the repository again, within the web client.
    await page.getByRole('banner').getByRole('link', { name: /Front Burner|Dashboard/ }).click();
    await page.getByRole('link', { name: 'handbook', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/repositories/${handbook}/files/docs/guide.md$`));
    await expect(editor(page).getByRole('heading', { name: 'guide.md' })).toBeVisible();

    await page.getByRole('banner').getByRole('link', { name: /Front Burner|Dashboard/ }).click();
    await page.getByRole('link', { name: 'empty-one', exact: true }).click();
    await expect(editor(page).getByText('Choose a file from the tree, or create one')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/repositories/${empty}$`));
  });

  test('AC-FILE-001.6: reopens docs/guide.md on reload with docs expanded and the file highlighted', async ({ page, instance }) => {
    const [ handbook ] = seedRepositories(instance.dataDir, [ { name: 'handbook', workingCopy: 'handbook' } ]);
    await openScreen(page, `/repositories/${handbook}/files/docs/guide.md`);

    for (let visit = 0; visit < 2; visit++) {
      await expect(editor(page).getByRole('heading', { name: 'guide.md' })).toBeVisible();
      await showTree(page);
      await expect(entry(page, 'docs')).toHaveAttribute('aria-expanded', 'true');
      await expect(entry(page, 'guide.md')).toHaveAttribute('aria-selected', 'true');
      await page.reload();
    }
  });

  test('AC-APP-001.8: goes back from a file to the previous file and from the screen to the dashboard', async ({ page, instance }) => {
    seedRepositories(instance.dataDir, [ { name: 'handbook', workingCopy: 'handbook' } ]);
    const loaded = page.waitForResponse('**/api/v1/repositories/recent');
    await page.goto('/');
    await logIn(page);
    await loaded;

    await page.getByRole('link', { name: 'handbook', exact: true }).click();
    await expect(page).toHaveURL(/\/files\/README.md$/);
    await showTree(page);
    await entry(page, 'docs').click();
    await entry(page, 'guide.md').click();
    await expect(page).toHaveURL(/\/files\/docs\/guide.md$/);

    await page.goBack();
    await expect(page).toHaveURL(/\/files\/README.md$/);
    await expect(editor(page).getByRole('heading', { name: 'README.md' })).toBeVisible();

    // Opening the README replaced the screen's URL, so Back leaves the screen.
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('link', { name: 'handbook', exact: true })).toBeVisible();
  });

  test('AC-FILE-001.7: lists a folder in natural order', async ({ page, instance }) => {
    const [ handbook ] = seedRepositories(instance.dataDir, [ { name: 'handbook', workingCopy: 'handbook' } ]);
    await openScreen(page, `/repositories/${handbook}`);
    await showTree(page);
    await expect(entry(page, 'README.md')).toBeVisible();

    const names = await page.getByRole('tree', { name: 'Files' }).getByRole('treeitem').evaluateAll(rows =>
      rows.map(row => (row.getAttribute('aria-label') ?? '').split(',')[0])
    );
    const at = (name: string) => names.indexOf(name);
    // Folders first, dot-folders listed (FB-19), and numbers in numeric order (FB-17).
    for (const folder of [ '.claude', '.github', 'build', 'docs' ]) {
      expect(at(folder)).toBeGreaterThanOrEqual(0);
      expect(at(folder)).toBeLessThan(at('README.md'));
    }
    expect(at('2-setup.md')).toBeLessThan(at('10-deploy.md'));
    expect(names).not.toContain('.git');
    await expect(entry(page, 'vendor')).not.toHaveAttribute('aria-expanded');
  });

  test('AC-FILE-001.12: marks ignored entries and explains the icon by hover and by tap', async ({ page, instance, isMobile }) => {
    const [ handbook ] = seedRepositories(instance.dataDir, [ { name: 'handbook', workingCopy: 'handbook' } ]);
    await openScreen(page, `/repositories/${handbook}/files/README.md`);
    await showTree(page);

    const colour = (name: string) =>
      entry(page, name).locator('.name').evaluate(element => getComputedStyle(element).color);
    expect(await colour('debug.log')).not.toBe(await colour('README.md'));
    expect(await colour('build')).toBe(await colour('debug.log'));
    await expect(ignoredIcon(page, 'debug.log')).toBeVisible();
    await expect(ignoredIcon(page, 'build')).toBeVisible();
    // A tracked file that matches a rule looks like any other file.
    expect(await colour('keep.log')).toBe(await colour('README.md'));
    await expect(ignoredIcon(page, 'keep.log')).toHaveCount(0);
    await expect(entry(page, 'debug.log')).toHaveText('debug.log');

    await explainIgnored(page, 'debug.log', isMobile);
    await expect(tooltip(page)).toHaveText(IGNORED_FILE);
    await explainIgnored(page, 'build', isMobile);
    await expect(tooltip(page)).toHaveText(IGNORED_FOLDER);
    // The icon neither opens nor expands its entry.
    await expect(page).toHaveURL(/\/files\/README.md$/);
    await expect(entry(page, 'build')).toHaveAttribute('aria-expanded', 'false');
    await expect(entry(page, 'debug.log')).toHaveAttribute('aria-selected', 'false');
  });

  test('AC-FILE-001.22: shows Try again for a folder that fails', async ({ page, instance, monitor, isMobile }) => {
    const [ handbook ] = seedRepositories(instance.dataDir, [ { name: 'handbook', workingCopy: 'handbook' } ]);
    let failures = 1;
    await page.route(/\/api\/v1\/repositories\/\d+\/folder\?path=docs$/, route =>
      failures-- > 0
        ? route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'internal', params: {}, requestId: '', message: 'Internal error' })
        })
        : route.continue());
    await openScreen(page, `/repositories/${handbook}/files/README.md`);
    await showTree(page);

    await entry(page, 'docs').click();
    const error = page.getByRole('treeitem', { name: /^This folder could not be loaded/ });
    await expect(error).toBeVisible();
    await expect(error).toContainText('Try again');

    // The rest of the tree still works.
    await entry(page, '2-setup.md').click();
    await expect(page).toHaveURL(/\/files\/2-setup.md$/);
    await drawerClosedOnPhone(page, isMobile);
    await showTree(page);

    await error.click();
    await expect(entry(page, 'guide.md')).toBeVisible();
    await expect(entry(page, '2-setup.md')).toHaveAttribute('aria-selected', 'true');

    drainFailedRequests(monitor, `/api/v1/repositories/${handbook}/folder`);
  });

  test('AC-FILE-001.22: opens the route\'s file once its folder loads on Try again', async ({ page, instance, monitor }) => {
    const [ handbook ] = seedRepositories(instance.dataDir, [ { name: 'handbook', workingCopy: 'handbook' } ]);
    let failures = 1;
    await page.route(/\/api\/v1\/repositories\/\d+\/folder\?path=docs$/, route =>
      failures-- > 0
        ? route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'internal', params: {}, requestId: '', message: 'Internal error' })
        })
        : route.continue());
    await openScreen(page, `/repositories/${handbook}/files/docs/guide.md`);
    await showTree(page);

    const error = page.getByRole('treeitem', { name: /^This folder could not be loaded/ });
    await expect(error).toBeVisible();
    await expect(editor(page).getByText('This file doesn\'t exist.')).toHaveCount(0);

    await error.click();
    // On a phone the drawer stays open over the editor area after Try again.
    await expect(page.locator('main h2')).toHaveText('guide.md');

    drainFailedRequests(monitor, `/api/v1/repositories/${handbook}/folder`);
  });

  test('AC-FILE-001.23: browses with the keyboard alone', async ({ page, instance, isMobile }) => {
    test.skip(isMobile, 'phones are browsed by touch');
    const [ handbook ] = seedRepositories(instance.dataDir, [ { name: 'handbook', workingCopy: 'handbook' } ]);
    await openScreen(page, `/repositories/${handbook}/files/README.md`);
    const files = page.getByRole('tree', { name: 'Files' });
    await expect(entry(page, 'README.md')).toHaveAttribute('aria-selected', 'true');

    // Tabbing in lands on the open file.
    await filesButton(page).focus();
    while (!(await files.evaluate(element => element === document.activeElement))) {
      await page.keyboard.press('Tab');
    }
    await expectActive(page, 'README.md');

    await page.keyboard.type('debug');
    await expect(tooltip(page)).toHaveText(IGNORED_FILE);

    // .claude, .github, build, docs.
    await page.keyboard.press('Home');
    for (let row = 0; row < 3; row++) {
      await page.keyboard.press('ArrowDown');
    }
    await expectActive(page, 'docs');
    await expect(tooltip(page)).toHaveCount(0);
    await page.keyboard.press('ArrowRight');
    await expect(entry(page, 'docs')).toHaveAttribute('aria-expanded', 'true');
    // Past the folder's loading row, once it has loaded.
    await expect(entry(page, 'guide.md')).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/files\/docs\/guide.md$/);
    await expect(editor(page).getByRole('heading', { name: 'guide.md' })).toBeVisible();
  });

  test('AC-FILE-001.23: browses by touch alone', async ({ page, instance, isMobile }) => {
    test.skip(!isMobile, 'touch is for phones');
    const [ handbook ] = seedRepositories(instance.dataDir, [ { name: 'handbook', workingCopy: 'handbook' } ]);
    await openScreen(page, `/repositories/${handbook}/files/README.md`);

    await filesButton(page).tap();
    await entry(page, 'docs').tap();
    await expect(entry(page, 'docs')).toHaveAttribute('aria-expanded', 'true');
    await entry(page, 'guide.md').tap();

    await expect(page).toHaveURL(/\/files\/docs\/guide.md$/);
    await expect(tree(page)).toBeHidden();
  });

  test('has no axe violations with folders expanded and an ignored message open', async ({ page, instance, isMobile }) => {
    const [ handbook ] = seedRepositories(instance.dataDir, [ { name: 'handbook', workingCopy: 'handbook' } ]);
    await openScreen(page, `/repositories/${handbook}/files/docs/guide.md`);
    await showTree(page);
    await entry(page, '.github').click();
    await expect(entry(page, 'workflows')).toBeVisible();
    await explainIgnored(page, 'debug.log', isMobile);
    await expect(tooltip(page)).toBeVisible();

    expect((await axe(page, isMobile).analyze()).violations).toEqual([]);
  });

  test('AC-FILE-001.13: creates notes.md and opens it, warning inside an ignored folder', async ({ page, instance, isMobile }) => {
    const [ handbook ] = seedRepositories(instance.dataDir, [ { name: 'handbook', workingCopy: 'handbook' } ]);
    await openScreen(page, `/repositories/${handbook}/files/README.md`);

    await createInRoot(page, 'New file', isMobile);
    await expect(nameField(page)).toHaveValue('untitled.md');
    await nameField(page).fill('notes');
    await expect(dialog(page).getByText('Will be created as notes.md')).toBeVisible();
    await confirmDialog(page, 'Create', isMobile);

    await expect(page).toHaveURL(new RegExp(`/repositories/${handbook}/files/notes.md$`));
    await expect(editor(page).getByRole('heading', { name: 'notes.md' })).toBeVisible();
    await expect(editor(page).getByText(LATER)).toBeVisible();

    await entryAction(page, 'build', 'New file', isMobile);
    await expect(dialog(page).getByText(IGNORED_NEW_FILE)).toBeVisible();
    await confirmDialog(page, 'Create', isMobile);

    await expect(page).toHaveURL(new RegExp(`/repositories/${handbook}/files/build/untitled.md$`));
  });

  test('AC-FILE-001.14: refuses readme.md next to README.md and renames README.md to readme.md', async ({ page, instance, isMobile }) => {
    const [ handbook ] = seedRepositories(instance.dataDir, [ { name: 'handbook', workingCopy: 'handbook' } ]);
    await openScreen(page, `/repositories/${handbook}/files/docs/guide.md`);

    await createInRoot(page, 'New file', isMobile);
    await nameField(page).fill('readme.md');
    await expect(dialog(page).getByText(NAME_TAKEN)).toBeVisible();
    await confirmDialog(page, 'Create', isMobile);
    await expect(dialog(page)).toBeVisible();
    await confirmDialog(page, 'Cancel', isMobile);
    await expect(dialog(page)).toBeHidden();

    await entryAction(page, 'README.md', 'Rename', isMobile);
    await nameField(page).fill('readme.md');
    await expect(dialog(page).getByText(NAME_TAKEN)).toBeHidden();
    await confirmDialog(page, 'Rename', isMobile);

    await expect(dialog(page)).toBeHidden();
    await expect(entry(page, 'readme.md')).toBeVisible();
    await expect(entry(page, 'README.md')).toHaveCount(0);
  });

  test('AC-FILE-001.15: creates an empty folder with the note', async ({ page, instance, isMobile }) => {
    const [ handbook ] = seedRepositories(instance.dataDir, [ { name: 'handbook', workingCopy: 'handbook' } ]);
    await openScreen(page, `/repositories/${handbook}/files/README.md`);

    await createInRoot(page, 'New folder', isMobile);
    await expect(dialog(page).getByText(EMPTY_FOLDER)).toBeVisible();
    await nameField(page).fill('drafts');
    await confirmDialog(page, 'Create', isMobile);

    await expect(dialog(page)).toBeHidden();
    await expect(entry(page, 'drafts')).toHaveAttribute('aria-label', 'drafts, folder, empty');
    await expect(entry(page, 'drafts')).toHaveAttribute('aria-expanded', 'true');
    await expect(tree(page).getByText(EMPTY_FOLDER)).toBeVisible();
    await expectActive(page, 'drafts');
  });

  test('AC-FILE-001.16: renames guide.md to guide.txt.md, offers no Rename for a .png, and confirms twice for a folder with images', async ({ page, instance, isMobile }) => {
    const [ handbook ] = seedRepositories(instance.dataDir, [ { name: 'handbook', workingCopy: 'handbook' } ]);
    await openScreen(page, `/repositories/${handbook}/files/README.md`);
    await showTree(page);
    await press(page, entry(page, 'docs'), isMobile);

    await entryAction(page, 'guide.md', 'Rename', isMobile);
    await nameField(page).fill('guide.txt');
    await expect(dialog(page).getByText('Will be renamed to guide.txt.md')).toBeVisible();
    await confirmDialog(page, 'Rename', isMobile);
    await expect(entry(page, 'guide.txt.md')).toBeVisible();

    await press(page, entry(page, 'logo.png').getByRole('button', { name: 'Actions for logo.png' }), isMobile);
    await expect(page.getByRole('menuitem', { name: 'Delete', exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Rename', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');

    await entryAction(page, 'media', 'Rename', isMobile);
    await nameField(page).fill('pictures');
    await confirmDialog(page, 'Rename', isMobile);
    await expect(page.getByText('2 non-Markdown files move with this folder.')).toBeVisible();
    await confirmDialog(page, 'Cancel', isMobile);
    // The rename dialog stays as it was.
    await expect(nameField(page)).toHaveValue('pictures');
    await confirmDialog(page, 'Rename', isMobile);
    await expect(page.getByText('2 non-Markdown files move with this folder.')).toBeVisible();
    await confirmDialog(page, 'Rename', isMobile);

    await expect(dialog(page)).toBeHidden();
    await expect(entry(page, 'pictures')).toBeVisible();
    await expect(entry(page, 'media')).toHaveCount(0);
  });

  test('AC-FILE-001.17: keeps a renamed open file open', async ({ page, instance, isMobile }) => {
    const [ handbook ] = seedRepositories(instance.dataDir, [ { name: 'handbook', workingCopy: 'handbook' } ]);
    await openScreen(page, `/repositories/${handbook}/files/docs/guide.md`);

    await entryAction(page, 'docs', 'Rename', isMobile);
    await nameField(page).fill('guides');
    await confirmDialog(page, 'Rename', isMobile);

    await expect(page).toHaveURL(new RegExp(`/repositories/${handbook}/files/guides/guide.md$`));
    await expect(entry(page, 'guides')).toHaveAttribute('aria-expanded', 'true');
    await expect(entry(page, 'guide.md')).toHaveAttribute('aria-selected', 'true');

    await entryAction(page, 'guide.md', 'Rename', isMobile);
    await nameField(page).fill('intro');
    await confirmDialog(page, 'Rename', isMobile);

    await expect(page).toHaveURL(new RegExp(`/repositories/${handbook}/files/guides/intro.md$`));
    // On a phone the drawer stays open after a rename, over the editor area.
    await expect(entry(page, 'intro.md')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('main h2')).toHaveText('intro.md');
  });

  test('AC-FILE-001.23: creates and renames with the keyboard alone', async ({ page, instance, isMobile }) => {
    test.skip(isMobile, 'phones are used by touch');
    const [ handbook ] = seedRepositories(instance.dataDir, [ { name: 'handbook', workingCopy: 'handbook' } ]);
    await openScreen(page, `/repositories/${handbook}/files/README.md`);
    const files = page.getByRole('tree', { name: 'Files' });
    await expect(entry(page, 'README.md')).toHaveAttribute('aria-selected', 'true');
    await files.focus();

    // .claude, .github, build, docs.
    await page.keyboard.press('Home');
    for (let row = 0; row < 3; row++) {
      await page.keyboard.press('ArrowDown');
    }
    await expectActive(page, 'docs');
    await page.keyboard.press('Shift+F10');
    await expect(page.getByRole('menuitem', { name: 'New file' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(nameField(page)).toBeFocused();
    await page.keyboard.type('intro');
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(new RegExp(`/repositories/${handbook}/files/docs/intro.md$`));

    // Back in the tree, typing finds the new file's row.
    await expect(entry(page, 'intro.md')).toHaveAttribute('aria-selected', 'true');
    await files.focus();
    await page.keyboard.type('intro');
    await expectActive(page, 'intro.md');
    await page.keyboard.press('Shift+F10');
    await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeFocused();
    await page.keyboard.press('Enter');
    // The name without its extension is selected, so typing keeps `.md`.
    await expect(nameField(page)).toBeFocused();
    await page.keyboard.type('overview');
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(new RegExp(`/repositories/${handbook}/files/docs/overview.md$`));
  });

  test('AC-FILE-001.23: creates and renames by touch alone', async ({ page, instance, isMobile }) => {
    test.skip(!isMobile, 'touch is for phones');
    const [ handbook ] = seedRepositories(instance.dataDir, [ { name: 'handbook', workingCopy: 'handbook' } ]);
    await openScreen(page, `/repositories/${handbook}/files/README.md`);

    await entryAction(page, 'docs', 'New file', true);
    await nameField(page).fill('intro');
    await confirmDialog(page, 'Create', true);
    await expect(page).toHaveURL(new RegExp(`/repositories/${handbook}/files/docs/intro.md$`));

    await entryAction(page, 'intro.md', 'Rename', true);
    await nameField(page).fill('overview');
    await confirmDialog(page, 'Rename', true);
    await expect(page).toHaveURL(new RegExp(`/repositories/${handbook}/files/docs/overview.md$`));
  });

  test('has no axe violations with each dialog open', async ({ page, instance, isMobile }) => {
    // Without the dialogs' opening animation, which axe would see half-transparent.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const [ handbook ] = seedRepositories(instance.dataDir, [ { name: 'handbook', workingCopy: 'handbook' } ]);
    await openScreen(page, `/repositories/${handbook}/files/README.md`);
    const check = async () =>
      expect((await new AxeBuilder({ page }).include('.cdk-overlay-container').analyze()).violations)
        .toEqual([]);

    await createInRoot(page, 'New file', isMobile);
    await nameField(page).fill('readme.md');
    await expect(dialog(page).getByText(NAME_TAKEN)).toBeVisible();
    await check();
    await confirmDialog(page, 'Cancel', isMobile);

    await createInRoot(page, 'New folder', isMobile);
    await check();
    await confirmDialog(page, 'Cancel', isMobile);

    await entryAction(page, 'media', 'Rename', isMobile);
    await nameField(page).fill('pictures');
    await check();
    await confirmDialog(page, 'Rename', isMobile);
    await expect(page.getByText('2 non-Markdown files move with this folder.')).toBeVisible();
    await check();
  });

  test('AC-FILE-001.18: confirms deletes with the counts and the recovery warning', async ({ page, instance, isMobile }) => {
    const [ handbook ] = seedRepositories(instance.dataDir, [ { name: 'handbook', workingCopy: 'handbook' } ]);
    await openScreen(page, `/repositories/${handbook}/files/README.md`);

    await entryAction(page, 'debug.log', 'Delete', isMobile);
    await expect(heading(page, 'Delete debug.log?')).toBeVisible();
    await expect(dialog(page).getByText(UNCOMMITTED_FILE)).toBeVisible();
    await confirmDialog(page, 'Cancel', isMobile);
    await expect(dialog(page)).toBeHidden();

    await entryAction(page, 'media', 'Delete', isMobile);
    await expect(dialog(page).getByText('It holds 3 files, 2 of them non-Markdown.')).toBeVisible();
    await expect(dialog(page).getByText(/can't be recovered/)).toHaveCount(0);
    await confirmDialog(page, 'Cancel', isMobile);

    await entryAction(page, 'build', 'Delete', isMobile);
    await expect(dialog(page).getByText('It holds 1 file, 1 of them non-Markdown.')).toBeVisible();
    await expect(dialog(page).getByText('1 file isn\'t committed, so it can\'t be recovered.')).toBeVisible();
    await confirmDialog(page, 'Cancel', isMobile);

    await entryAction(page, '2-setup.md', 'Delete', isMobile);
    await expect(heading(page, 'Delete 2-setup.md?')).toBeVisible();
    await expect(dialog(page).getByRole('button', { name: 'Delete', exact: true })).toBeVisible();
    await expect(dialog(page).getByText(UNCOMMITTED_FILE)).toHaveCount(0);
    await confirmDialog(page, 'Delete', isMobile);

    await expect(dialog(page)).toBeHidden();
    await expect(entry(page, '2-setup.md')).toHaveCount(0);
    await expect(entry(page, 'README.md')).toBeVisible();
  });

  test('AC-FILE-001.19: closes the open file when it is deleted', async ({ page, instance, isMobile }) => {
    const [ handbook ] = seedRepositories(instance.dataDir, [ { name: 'handbook', workingCopy: 'handbook' } ]);
    await openScreen(page, `/repositories/${handbook}/files/docs/guide.md`);

    await entryAction(page, 'guide.md', 'Delete', isMobile);
    await confirmDialog(page, 'Delete', isMobile);

    await expect(page).toHaveURL(new RegExp(`/repositories/${handbook}$`));
    await expect(entry(page, 'guide.md')).toHaveCount(0);
    // The empty state, not the README (FB-39).
    await hideTreeOnPhone(page, isMobile);
    await expect(editor(page).getByText(EMPTY_STATE)).toBeVisible();

    // The folder that holds the open file closes it too.
    await page.goto(`/repositories/${handbook}/files/media/cover.md`);
    await expect(editor(page).getByRole('heading', { name: 'cover.md' })).toBeVisible();
    await entryAction(page, 'media', 'Delete', isMobile);
    await confirmDialog(page, 'Delete', isMobile);

    await expect(page).toHaveURL(new RegExp(`/repositories/${handbook}$`));
    await expect(entry(page, 'media')).toHaveCount(0);
    await hideTreeOnPhone(page, isMobile);
    await expect(editor(page).getByText(EMPTY_STATE)).toBeVisible();
  });

  test('AC-FILE-001.11: deletes a symbolic link from the tree', async ({ page, instance, isMobile }) => {
    const [ handbook ] = seedRepositories(instance.dataDir, [ { name: 'handbook', workingCopy: 'handbook' } ]);
    await openScreen(page, `/repositories/${handbook}/files/latest`);
    await expect(editor(page).getByText('Symbolic links can\'t be opened.')).toBeVisible();

    // From the editor area's message panel (FB-21).
    await press(page, editor(page).getByRole('button', { name: 'Delete', exact: true }), isMobile);
    await expect(dialog(page).getByText('Only the link is deleted, not what it points to.')).toBeVisible();
    await confirmDialog(page, 'Delete', isMobile);

    await expect(page).toHaveURL(new RegExp(`/repositories/${handbook}$`));
    await showTree(page);
    await expect(entry(page, 'latest')).toHaveCount(0);
    await expect(entry(page, 'README.md')).toBeVisible();
  });

  test('AC-FILE-001.26: shows Deleting… while a folder is deleted', async ({ page, instance, isMobile }) => {
    const [ handbook ] = seedRepositories(instance.dataDir, [ { name: 'handbook', workingCopy: 'handbook' } ]);
    await openScreen(page, `/repositories/${handbook}/files/README.md`);
    let release!: () => void;
    const released = new Promise<void>(resolve => (release = resolve));
    await page.route(
      url => url.pathname.endsWith('/entries') && url.searchParams.get('path') === 'media',
      async route => {
        if (route.request().method() === 'DELETE') {
          await released;
        }
        await route.continue();
      }
    );

    await entryAction(page, 'media', 'Delete', isMobile);
    await confirmDialog(page, 'Delete', isMobile);

    // Behind the dialog, which waits for the answer: the row says so, the rest of the tree stays.
    const row = page.locator('[role="treeitem"]', { hasText: 'media' });
    await expect(row).toContainText('Deleting…');
    await expect(row).toHaveAttribute('aria-label', 'media, folder, Deleting…');
    await expect(row.getByRole('button', { name: 'Actions for media' })).toHaveCount(0);
    await expect(page.locator('[role="treeitem"]', { hasText: 'README.md' })).toBeVisible();

    release();
    await expect(dialog(page)).toBeHidden();
    await expect(entry(page, 'media')).toHaveCount(0);
    // The tree is usable again at once.
    await press(page, entry(page, 'docs'), isMobile);
    await expect(entry(page, 'guide.md')).toBeVisible();
  });

  test('AC-FILE-001.23: deletes with the keyboard alone', async ({ page, instance, isMobile }) => {
    test.skip(isMobile, 'phones are used by touch');
    const [ handbook ] = seedRepositories(instance.dataDir, [ { name: 'handbook', workingCopy: 'handbook' } ]);
    await openScreen(page, `/repositories/${handbook}/files/README.md`);
    const files = page.getByRole('tree', { name: 'Files' });
    await expect(entry(page, 'README.md')).toHaveAttribute('aria-selected', 'true');
    await files.focus();

    await page.keyboard.type('logo');
    await expectActive(page, 'logo.png');
    await page.keyboard.press('Shift+F10');
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeFocused();
    await page.keyboard.press('Enter');
    // Cancel, the safe choice, has the focus; Delete comes once the summary is there.
    await expect(dialog(page).getByRole('button', { name: 'Cancel' })).toBeFocused();
    await expect(dialog(page).getByRole('button', { name: 'Delete', exact: true })).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(dialog(page).getByRole('button', { name: 'Delete', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(dialog(page)).toBeHidden();
    await expect(entry(page, 'logo.png')).toHaveCount(0);
  });

  test('AC-FILE-001.23: deletes by touch alone', async ({ page, instance, isMobile }) => {
    test.skip(!isMobile, 'touch is for phones');
    const [ handbook ] = seedRepositories(instance.dataDir, [ { name: 'handbook', workingCopy: 'handbook' } ]);
    await openScreen(page, `/repositories/${handbook}/files/README.md`);

    await entryAction(page, 'logo.png', 'Delete', true);
    await confirmDialog(page, 'Delete', true);

    await expect(dialog(page)).toBeHidden();
    await expect(entry(page, 'logo.png')).toHaveCount(0);
  });

  test('has no axe violations with the delete dialog open', async ({ page, instance, isMobile }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const [ handbook ] = seedRepositories(instance.dataDir, [ { name: 'handbook', workingCopy: 'handbook' } ]);
    await openScreen(page, `/repositories/${handbook}/files/README.md`);

    await entryAction(page, 'build', 'Delete', isMobile);
    await expect(dialog(page).getByText('It holds 1 file, 1 of them non-Markdown.')).toBeVisible();

    expect((await new AxeBuilder({ page }).include('.cdk-overlay-container').analyze()).violations).toEqual([]);
  });
});
