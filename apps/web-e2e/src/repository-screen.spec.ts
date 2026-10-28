import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
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

    await page.goto('/');
    await page.goto(`/repositories/${handbook}`);
    await expect(page).toHaveURL(new RegExp(`/repositories/${handbook}/files/docs/guide.md$`));
    await expect(editor(page).getByRole('heading', { name: 'guide.md' })).toBeVisible();

    await page.goto(`/repositories/${empty}`);
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
});
