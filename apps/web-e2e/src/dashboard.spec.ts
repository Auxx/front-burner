import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { logIn, seed, type SeedRepository } from './support/instance';

test.use({ instanceOptions: { onboarded: true } });

/** The administrator that onboarding created. */
const ADMIN_ID = 1;

const heading = (page: Page, name: string) => page.getByRole('heading', { name, exact: true });
const addRepository = (page: Page) => page.getByRole('link', { name: 'Add repository' });
const recentList = (page: Page) => page.getByRole('list').filter({ has: page.getByRole('listitem') });

/** Logs in from `/` and waits for the dashboard to have loaded its list. */
async function openDashboard(page: Page, email?: string): Promise<void> {
  const loaded = page.waitForResponse('**/api/v1/repositories/recent');
  await page.goto('/');
  await logIn(page, email);
  await loaded;
  await expect(heading(page, 'Dashboard')).toBeVisible();
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

function seedRepositories(dataDir: string, repositories: Omit<SeedRepository, 'userId'>[]): number[] {
  return seed(dataDir, { repositories: repositories.map(repository => ({ userId: ADMIN_ID, ...repository })) })
    .repositoryIds;
}

function fitsWidth(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

test.describe('dashboard', () => {
  test('AC-DASH-001.1: an administrator and a user land on the dashboard', async ({ page, instance }) => {
    seed(instance.dataDir, { users: [ { email: 'user@example.com' } ] });

    await openDashboard(page);
    await expect(page).toHaveURL(/\/$/);
    await expect(page).toHaveTitle('Dashboard · Front Burner');

    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
    await openDashboard(page, 'user@example.com');
    await expect(page).toHaveURL(/\/$/);
  });

  test('AC-DASH-001.2: without repositories, the full guide and no list', async ({ page }) => {
    await openDashboard(page);

    await expect(heading(page, 'Add your first repository')).toBeVisible();
    await expect(page.getByRole('listitem')).toHaveCount(3);
    await expect(addRepository(page)).toBeVisible();
    await expect(heading(page, 'Recent repositories')).toHaveCount(0);
  });

  test('AC-DASH-001.3 and AC-DASH-001.10: the compact guide above the list, How it works in place', async ({ page, instance }) => {
    seedRepositories(instance.dataDir, [
      { name: 'handbook', remoteUrl: 'https://u:t@github.com/acme/handbook.git', lastAccessedAt: minutesAgo(180) }
    ]);
    await openDashboard(page);

    await expect(page.getByText('Add another repository from an HTTPS or SSH URL')).toBeVisible();
    const recent = heading(page, 'Recent repositories');
    await expect(recent).toBeVisible();
    const guideBox = await addRepository(page).boundingBox();
    const recentBox = await recent.boundingBox();
    expect((guideBox?.y ?? 0) < (recentBox?.y ?? 0)).toBe(true);

    const entry = recentList(page).getByRole('listitem');
    await expect(entry).toHaveCount(1);
    await expect(entry).toContainText('handbook');
    await expect(entry).toContainText('github.com/acme/handbook');
    await expect(entry).not.toContainText('u:t');
    await expect(entry).toContainText('Last accessed 3 hours ago');

    const howItWorks = page.getByRole('button', { name: 'How it works' });
    await howItWorks.click();
    await expect(howItWorks).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('Copy the remote URL')).toBeVisible();
    await howItWorks.click();
    await expect(page.getByText('Copy the remote URL')).toHaveCount(0);
  });

  test('AC-DASH-001.4: Add repository starts the add-repository flow from both guides', async ({ page, instance }) => {
    await openDashboard(page);
    await addRepository(page).click();
    await expect(page).toHaveURL(/\/repositories\/new$/);

    seedRepositories(instance.dataDir, [ { name: 'handbook' } ]);
    const loaded = page.waitForResponse('**/api/v1/repositories/recent');
    await page.goto('/');
    await loaded;
    await expect(page.getByRole('button', { name: 'How it works' })).toBeVisible();
    await addRepository(page).click();
    await expect(page).toHaveURL(/\/repositories\/new$/);
  });

  test('AC-DASH-001.5: 10 of 12, most recent first, and All repositories', async ({ page, instance }) => {
    seedRepositories(
      instance.dataDir,
      Array.from({ length: 12 }, (_, i) => ({ name: `repo-${i}`, lastAccessedAt: minutesAgo(100 - i) }))
    );
    await openDashboard(page);

    const names = recentList(page).getByRole('link', { name: /^repo-/ });
    await expect(names).toHaveText([ 11, 10, 9, 8, 7, 6, 5, 4, 3, 2 ].map(i => `repo-${i}`));
    await expect(page.getByRole('link', { name: 'All repositories' })).toHaveAttribute('href', '/repositories');
  });

  test('AC-DASH-001.13: cloning and failed repositories show their status and link to their settings', async ({ page, instance }) => {
    const [ cloning, failed ] = seedRepositories(instance.dataDir, [
      { name: 'cloning-one', status: 'cloning', lastAccessedAt: minutesAgo(1) },
      { name: 'failed-one', status: 'error', errorCode: 'clone-failed', lastAccessedAt: minutesAgo(2) }
    ]);
    await openDashboard(page);

    const entries = recentList(page).getByRole('listitem');
    await expect(entries.nth(0)).toContainText('Cloning');
    await expect(entries.nth(1)).toContainText('Error');
    await expect(entries.nth(1)).toContainText('Clone failed');
    await expect(page.getByRole('link', { name: 'cloning-one', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'failed-one', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Settings of cloning-one' })).toHaveAttribute(
      'href',
      `/repositories/${cloning}/settings`
    );
    await expect(page.getByRole('link', { name: 'Settings of failed-one' })).toHaveAttribute(
      'href',
      `/repositories/${failed}/settings`
    );
  });

  test('AC-DASH-001.15: a failed load shows Try again, and Add repository still works', async ({ page, instance, monitor }) => {
    seedRepositories(instance.dataDir, [ { name: 'handbook' } ]);
    // Fails until Try again, also for the reload after the push channel connects (A-3.11).
    let failing = true;
    await page.route('**/api/v1/repositories/recent', route => (failing ? route.abort() : route.fallback()));
    await page.goto('/');
    await logIn(page);

    await expect(page.getByRole('main').getByText('Your repositories could not be loaded.')).toBeVisible();
    await expect(addRepository(page)).toBeEnabled();
    failing = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(heading(page, 'Recent repositories')).toBeVisible();
    await expect(page.getByRole('main').getByText('Your repositories could not be loaded.')).toHaveCount(0);

    // The aborted request is logged on purpose.
    monitor.consoleErrors.splice(0);
  });

  /** Whether the compact guide's button is below its text, and whether the page fits its width. */
  async function compactGuideLayout(page: Page, dataDir: string): Promise<{ buttonBelow: boolean; fits: boolean; }> {
    seedRepositories(dataDir, [
      { name: 'a-repository-with-a-rather-long-name', remoteUrl: 'git@bitbucket.org:a-team/with-a-long-path.git' }
    ]);
    await openDashboard(page);

    const text = await page.getByText('Add another repository from an HTTPS or SSH URL').boundingBox();
    const button = await addRepository(page).boundingBox();
    return { buttonBelow: (button?.y ?? 0) >= (text?.y ?? 0) + (text?.height ?? 0), fits: await fitsWidth(page) };
  }

  test('AC-DASH-001.16: on a phone, the compact guide\'s button is below its text and nothing scrolls sideways', async ({ page, instance, isMobile }) => {
    test.skip(!isMobile, 'the phone projects run it');
    expect(await compactGuideLayout(page, instance.dataDir)).toEqual({ buttonBelow: true, fits: true });
  });

  test('AC-DASH-001.16: at 320 px, the compact guide\'s button is below its text and nothing scrolls sideways', async ({ page, instance }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    expect(await compactGuideLayout(page, instance.dataDir)).toEqual({ buttonBelow: true, fits: true });
  });

  test('has no accessibility violations, empty or with repositories', async ({ page, instance }) => {
    await openDashboard(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    seedRepositories(instance.dataDir, [
      { name: 'handbook' },
      { name: 'cloning-one', status: 'cloning' },
      { name: 'failed-one', status: 'error', errorCode: 'working-copy-missing' }
    ]);
    const loaded = page.waitForResponse('**/api/v1/repositories/recent');
    await page.goto('/');
    await loaded;
    await expect(heading(page, 'Recent repositories')).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
});
