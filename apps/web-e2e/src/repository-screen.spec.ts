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
});
