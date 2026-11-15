import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { drainFailedRequests, expect, test } from './support/fixtures';
import {
  createHandbookRemote,
  type GitHttpServer,
  startGitHttpServer,
  TEST_CERTIFICATE_FILE
} from './support/git-http-server';
import { keyboard, touch } from './support/hands';
import { logIn, seed, type SeedRepository } from './support/instance';

test.use({ instanceOptions: { onboarded: true } });

/** The administrator that onboarding created. */
const ADMIN_ID = 1;

const heading = (page: Page, name: string) => page.getByRole('heading', { name, exact: true });
const entries = (page: Page) => page.locator('repo-repository-list-entry');
const filter = (page: Page) => page.getByLabel('Filter by name or remote');

/** Logs in at `/repositories` and waits for the list to have loaded. */
async function openRepositories(page: Page): Promise<void> {
  const loaded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/repositories');
  await page.goto('/repositories');
  await logIn(page);
  await loaded;
  await expect(heading(page, 'Repositories')).toBeVisible();
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

function seedRepositories(dataDir: string, repositories: Omit<SeedRepository, 'userId'>[]): number[] {
  return seed(dataDir, { repositories: repositories.map(repository => ({ userId: ADMIN_ID, ...repository })) })
    .repositoryIds;
}

function fitsWidth(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

test.describe('repository management page', () => {
  test('AC-REPO-003.1: the repository management page lists all repositories sorted by name, with name, remote, last access time and status, filters them as the user types, and Add repository opens the Add repository page', async ({ page, instance }) => {
    seedRepositories(instance.dataDir, [
      { name: 'zeta', remoteUrl: 'https://u:t@github.com/acme/zeta.git', lastAccessedAt: minutesAgo(180) },
      { name: 'Alpha', remoteUrl: 'git@bitbucket.org:ada/journal.git', status: 'cloning' },
      { name: 'beta', status: 'error', errorCode: 'clone-failed' },
      // More than the dashboard's ten: the list is not paged.
      ...Array.from({ length: 10 }, (_, i) => ({ name: `notes-${String(i).padStart(2, '0')}` }))
    ]);
    await openRepositories(page);
    await expect(page).toHaveTitle('Repositories · Front Burner');

    const names = entries(page).locator('a.name');
    await expect(names).toHaveText([
      'Alpha',
      'beta',
      ...Array.from({ length: 10 }, (_, i) => `notes-${String(i).padStart(2, '0')}`),
      'zeta'
    ]);
    const zeta = entries(page).last();
    await expect(zeta).toContainText('github.com/acme/zeta');
    await expect(zeta).not.toContainText('u:t');
    await expect(zeta).toContainText('Last accessed 3 hours ago');
    await expect(zeta).toContainText('Ready');
    await expect(entries(page).first()).toContainText('Cloning');
    await expect(entries(page).nth(1)).toContainText('Error');
    await expect(entries(page).nth(1)).toContainText('Clone failed');

    await filter(page).pressSequentially('JOUR');
    await expect(names).toHaveText([ 'Alpha' ]);
    await expect(page.getByText('1 of 13 repositories shown')).toBeAttached();
    await filter(page).fill('nothing-like-it');
    await expect(entries(page)).toHaveCount(0);
    await expect(page.getByText('No repositories match nothing-like-it.')).toBeVisible();
    await filter(page).fill('');
    await expect(entries(page)).toHaveCount(13);

    await page.getByRole('link', { name: 'Add repository' }).click();
    await expect(page).toHaveURL(/\/repositories\/new$/);
  });

  test('AC-REPO-003.2: the dashboard\'s All repositories link opens this page, and its link for a repository in error opens that repository\'s settings page', async ({ page, instance }) => {
    const [ failed ] = seedRepositories(instance.dataDir, [
      { name: 'failed-one', status: 'error', errorCode: 'clone-failed' },
      { name: 'handbook' }
    ]);
    await page.goto('/');
    await logIn(page);

    await page.getByRole('link', { name: 'All repositories' }).click();
    await expect(page).toHaveURL(/\/repositories$/);
    await expect(heading(page, 'Repositories')).toBeVisible();
    await expect(entries(page)).toHaveCount(2);

    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Settings of failed-one' })).toHaveAttribute(
      'href',
      `/repositories/${failed}/settings`
    );
    // The same settings page as the entry's name on this page.
    await page.goto('/repositories');
    await expect(entries(page).getByRole('link', { name: 'failed-one', exact: true })).toHaveAttribute(
      'href',
      `/repositories/${failed}/settings`
    );
  });

  test('shows the full guide without repositories', async ({ page }) => {
    await openRepositories(page);

    await expect(heading(page, 'Add your first repository')).toBeVisible();
    await expect(filter(page)).toHaveCount(0);
    await expect(entries(page)).toHaveCount(0);
  });

  test('Open opens the repository screen', async ({ page, instance }) => {
    const [ handbook ] = seedRepositories(instance.dataDir, [ { name: 'handbook' } ]);
    await openRepositories(page);

    await page.getByRole('link', { name: 'Open handbook' }).click();
    await expect(page).toHaveURL(new RegExp(`/repositories/${handbook}$`));
  });

  test('fits a phone', async ({ page, instance, isMobile }) => {
    const [ long ] = seedRepositories(instance.dataDir, [
      {
        name: 'a-repository-with-a-rather-long-name-that-goes-on',
        remoteUrl: `https://github.com/acme/${'a'.repeat(80)}.git`
      },
      { name: 'cloning-one', status: 'cloning' }
    ]);
    if (!isMobile) {
      await page.setViewportSize({ width: 360, height: 720 });
    }
    await openRepositories(page);
    const width = page.viewportSize()?.width ?? 0;

    await expect(entries(page)).toHaveCount(2);
    expect(await fitsWidth(page)).toBe(true);
    const open = page.getByRole('link', { name: /^Open a-repository/ });
    for (const target of [ filter(page), page.getByRole('link', { name: 'Add repository' }), open ]) {
      await target.scrollIntoViewIfNeeded();
      const box = await target.boundingBox();
      expect(box).not.toBeNull();
      expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? Infinity) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
    }

    // By touch alone on a phone, by the keyboard alone on a desktop (RM-3).
    const hands = isMobile ? touch(page) : keyboard(page);
    await hands.typeInto(filter(page), 'long');
    await expect(entries(page)).toHaveCount(1);
    await hands.press(open);
    await expect(page).toHaveURL(new RegExp(`/repositories/${long}$`));
  });

  test('has no accessibility violations, empty or with repositories', async ({ page, instance }) => {
    await openRepositories(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    seedRepositories(instance.dataDir, [
      { name: 'handbook' },
      { name: 'cloning-one', status: 'cloning' },
      { name: 'failed-one', status: 'error', errorCode: 'working-copy-missing' }
    ]);
    await page.reload();
    await expect(entries(page)).toHaveCount(3);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await filter(page).fill('zzz');
    await expect(page.getByText('No repositories match zzz.')).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });

  test.describe('repository settings page', () => {
    /** Logs in at the settings page of `id` and waits for its details. */
    async function openSettings(page: Page, id: number | string): Promise<void> {
      const loaded = page.waitForResponse(response =>
        new URL(response.url()).pathname === `/api/v1/repositories/${id}/details`
      );
      await page.goto(`/repositories/${id}/settings`);
      await logIn(page);
      await loaded;
    }

    const cloneDetails = (page: Page) => page.getByRole('region', { name: 'Clone details' });

    test('AC-REPO-003.10: Clone details shows "Single branch: main" for a single-branch clone, and the git control level', async ({ page, instance }) => {
      const [ single, full ] = seedRepositories(instance.dataDir, [
        { name: 'single', cloneMode: 'single-branch', branch: 'main' },
        { name: 'full' }
      ]);
      await openSettings(page, single);

      await expect(heading(page, 'Clone details')).toBeVisible();
      const details = cloneDetails(page);
      await expect(details.locator('div[uiKeyValue]', { hasText: 'Clone mode' }).locator('dd')).toHaveText(
        'Single branch: main'
      );
      const level = details.locator('div[uiKeyValue]', { hasText: 'Git control level' }).locator('dd');
      await expect(level).toContainText('Advanced');
      await expect(level).toContainText('Full control over branches, commits and sync.');
      await expect(details.locator('div[uiKeyValue]', { hasText: 'Added' }).locator('time')).toBeVisible();

      await page.goto(`/repositories/${full}/settings`);
      await expect(cloneDetails(page).locator('div[uiKeyValue]', { hasText: 'Clone mode' }).locator('dd')).toHaveText(
        'Full clone'
      );
    });

    test('AC-APP-001.10: the repository settings page shows "Repositories › handbook › Settings", and the first two items are links', async ({ page, instance }) => {
      const [ handbook ] = seedRepositories(instance.dataDir, [ { name: 'handbook' } ]);
      await openSettings(page, handbook);

      const breadcrumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
      await expect(breadcrumbs.getByRole('listitem')).toHaveText([ 'Repositories', 'handbook' ]);
      await expect(breadcrumbs.getByRole('link', { name: 'Repositories' })).toHaveAttribute('href', '/repositories');
      await expect(breadcrumbs.getByRole('link', { name: 'handbook' })).toHaveAttribute(
        'href',
        `/repositories/${handbook}`
      );
      // The last item is the page's heading, not a link.
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Settings');
      await expect(page).toHaveTitle('Settings · handbook · Front Burner');
    });

    test('shows the name, remote, status and Open, and moves focus to the heading', async ({ page, instance }) => {
      const [ handbook ] = seedRepositories(instance.dataDir, [ { name: 'handbook' } ]);
      await openRepositories(page);

      await entries(page).getByRole('link', { name: 'handbook', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/repositories/${handbook}/settings$`));
      await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
      const main = page.getByRole('main');
      await expect(main).toContainText('git.invalid/acme/handbook');
      await expect(main).toContainText('Ready');

      await main.getByRole('link', { name: 'Open handbook' }).click();
      await expect(page).toHaveURL(new RegExp(`/repositories/${handbook}$`));
    });

    test('offers no Open for a repository that cannot be opened', async ({ page, instance }) => {
      const [ failed ] = seedRepositories(instance.dataDir, [
        { name: 'failed-one', status: 'error', errorCode: 'clone-failed' }
      ]);
      await openSettings(page, failed);

      await expect(page.getByRole('main')).toContainText('Error');
      await expect(page.getByRole('link', { name: 'Open failed-one' })).toHaveCount(0);
      await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'failed-one' }))
        .toHaveAttribute('href', `/repositories/${failed}/settings`);
    });

    test('shows Page not found for a missing, another user\'s or malformed repository', async ({ page, instance, monitor }) => {
      const { userIds: [ other ] } = seed(instance.dataDir, { users: [ { email: 'other@example.com' } ] });
      const { repositoryIds: [ theirs ] } = seed(instance.dataDir, {
        repositories: [ { userId: other, name: 'theirs' } ]
      });
      await openSettings(page, 999);
      await expect(page.getByRole('heading', { name: 'This page doesn\'t exist.' })).toBeVisible();
      await expect(page).toHaveTitle('Page not found · Front Burner');

      await page.goto(`/repositories/${theirs}/settings`);
      await expect(page.getByRole('heading', { name: 'This page doesn\'t exist.' })).toBeVisible();
      await expect(page.getByRole('main')).not.toContainText('theirs');

      await page.goto('/repositories/007/settings');
      await expect(page.getByRole('heading', { name: 'This page doesn\'t exist.' })).toBeVisible();
      drainFailedRequests(monitor, '/api/v1/repositories/999/details');
      drainFailedRequests(monitor, `/api/v1/repositories/${theirs}/details`);
    });

    test('fits a phone and has no accessibility violations', async ({ page, instance, isMobile }) => {
      const [ long ] = seedRepositories(instance.dataDir, [
        {
          name: 'a-repository-with-a-rather-long-name-that-goes-on',
          remoteUrl: `https://github.com/acme/${'a'.repeat(80)}.git`,
          cloneMode: 'single-branch',
          branch: 'main'
        }
      ]);
      if (!isMobile) {
        await page.setViewportSize({ width: 360, height: 720 });
      }
      await openSettings(page, long);

      await expect(heading(page, 'Clone details')).toBeVisible();
      expect(await fitsWidth(page)).toBe(true);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    });
  });

  test.describe('with a git server', () => {
    test.use({ instanceOptions: { onboarded: true, gitCaFile: TEST_CERTIFICATE_FILE } });

    let root: string;
    let git: GitHttpServer;
    /** Whether the clone has asked for objects, which wait for `release`. */
    let held = false;
    let release: () => void;
    const gate = new Promise<void>(resolve => (release = resolve));

    test.beforeAll(async () => {
      root = mkdtempSync(join(tmpdir(), 'front-burner-web-e2e-git-'));
      git = await startGitHttpServer({
        repositories: { 'handbook.git': createHandbookRemote(root) },
        beforeFetch: () => {
          held = true;
          return gate;
        }
      });
    });

    test.afterAll(async () => {
      release?.();
      await git?.close();
      rmSync(root, { recursive: true, force: true });
    });

    test('AC-REPO-003.3: a cloning repository shows its progress without a reload, and becomes Ready with Open when the clone ends', async ({ page }) => {
      await page.goto('/repositories/new');
      await logIn(page);
      await page.getByLabel('Remote URL').fill(`${git.url}/handbook.git`);
      await page.getByLabel('Remote URL').blur();
      await page.getByRole('radiogroup').getByText('No credentials (public repository)', { exact: true }).click();
      await page.getByRole('button', { name: 'Add repository' }).click();
      await expect(page).toHaveURL(/\/$/);

      await page.getByRole('link', { name: 'All repositories' }).click();
      const entry = entries(page).filter({ hasText: 'handbook' });
      await expect(entry).toContainText('Cloning');
      await expect(entry.getByRole('link', { name: 'Open handbook' })).toHaveCount(0);

      // The clone runs, held while it asks for objects: its progress shows, not "Waiting".
      await expect.poll(() => held).toBe(true);
      const progress = entry.getByRole('progressbar', { name: 'Cloning handbook' });
      await expect(progress).toBeVisible();
      await expect(progress).toHaveAttribute('aria-valuenow', '0');
      await expect(entry).toContainText('0%');
      await expect(entry).not.toContainText('Waiting for other clones to finish');
      // A reload of the page would drop this mark.
      await page.evaluate(() => Object.assign(window, { notReloaded: true }));
      release();

      await expect(entry).toContainText('Ready', { timeout: 30_000 });
      await expect(entry.getByRole('link', { name: 'Open handbook' })).toBeVisible();
      await expect(progress).toHaveCount(0);
      expect(await page.evaluate(() => 'notReloaded' in window)).toBe(true);
    });
  });
});
