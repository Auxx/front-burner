import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { drainFailedRequests, expect, test } from './support/fixtures';
import {
  createHandbookRemote,
  type GitHttpServer,
  startGitHttpServer,
  TEST_CERTIFICATE_FILE
} from './support/git-http-server';
import {
  type GitSshServer,
  PROTECTED_KEY_PASSPHRASE,
  PROTECTED_KEY_PUBLIC,
  startGitSshServer
} from './support/git-ssh-server';
import { keyboard, touch } from './support/hands';
import { adminAuthToken, confirmCommitAuthor, logIn, seed, type SeedRepository, TEST_ADMIN } from './support/instance';
import { addOverApi, api, sshRepository } from './support/repositories';
import { gitIn } from './support/working-copy';

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

    const statusSection = (page: Page) => page.getByRole('region', { name: 'Status' });

    test('shows a failed clone\'s label, with git\'s error as text and the request ID under Details', async ({ page, instance }) => {
      const [ failed ] = seedRepositories(instance.dataDir, [
        {
          name: 'failed-one',
          status: 'error',
          errorCode: 'clone-failed',
          errorDetail: 'fatal: <img src=x onerror="window.injected = true"> not found',
          errorRequestId: 'req-e2e-0123'
        }
      ]);
      await openSettings(page, failed);

      const status = statusSection(page);
      await expect(status).toContainText('Clone failed');
      const toggle = status.getByRole('button', { name: 'Details' });
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(status.getByText('Request ID:')).toBeHidden();

      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(status.locator('pre')).toHaveText('fatal: <img src=x onerror="window.injected = true"> not found');
      await expect(status.locator('img')).toHaveCount(0);
      expect(await page.evaluate(() => 'injected' in window)).toBe(false);
      await expect(status.locator('.request code')).toHaveText('req-e2e-0123');
      await expect(status.getByRole('button', { name: 'Copy the request ID' })).toBeVisible();
    });

    test('says when git recorded no message, and shows no Status for a ready repository', async ({ page, instance }) => {
      const [ timedOut, ready ] = seedRepositories(instance.dataDir, [
        { name: 'timed-out', status: 'error', errorCode: 'clone-timed-out' },
        { name: 'handbook' }
      ]);
      await openSettings(page, timedOut);

      const status = statusSection(page);
      await expect(status).toContainText('Clone timed out');
      await status.getByRole('button', { name: 'Details' }).click();
      await expect(status.getByText('No message from git was recorded.')).toBeVisible();
      await expect(status.getByText('Request ID:')).toHaveCount(0);

      await page.goto(`/repositories/${ready}/settings`);
      await expect(heading(page, 'Clone details')).toBeVisible();
      await expect(heading(page, 'Status')).toHaveCount(0);
    });

    test('shows a cloning repository\'s progress under Status', async ({ page, instance }) => {
      const [ cloning ] = seedRepositories(instance.dataDir, [ { name: 'cloning-one', status: 'cloning' } ]);
      await openSettings(page, cloning);

      // A seeded clone has no job: it shows the indeterminate bar of a clone not yet reported.
      await expect(statusSection(page).getByRole('progressbar', { name: 'Cloning cloning-one' })).toBeVisible();
    });

    test('fits a phone with a long error, and has no accessibility violations', async ({ page, instance, isMobile }) => {
      const [ failed ] = seedRepositories(instance.dataDir, [
        {
          name: 'failed-one',
          status: 'error',
          errorCode: 'clone-failed',
          errorDetail: `fatal: unable to access 'https://github.com/acme/${'a'.repeat(120)}.git/': ${
            'x'.repeat(200)
          }\nsecond line`,
          errorRequestId: `req-${'0'.repeat(60)}`
        }
      ]);
      if (!isMobile) {
        await page.setViewportSize({ width: 360, height: 720 });
      }
      await openSettings(page, failed);

      await statusSection(page).getByRole('button', { name: 'Details' }).click();
      await expect(statusSection(page).locator('pre')).toBeVisible();
      expect(await fitsWidth(page)).toBe(true);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
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

test.describe('the Credentials section', () => {
  test.use({ instanceOptions: { onboarded: true, gitCaFile: TEST_CERTIFICATE_FILE } });

  let root: string;
  let ssh: GitSshServer;
  let git: GitHttpServer;
  const sshRemotes: Record<string, string> = {};
  const httpsRemotes: Record<string, string> = {};
  const WRITER = { username: 'writer', password: 'push-token' };

  test.beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'front-burner-web-e2e-credentials-'));
    mkdirSync(join(root, 'https'));
    httpsRemotes['handbook.git'] = createHandbookRemote(join(root, 'https'));
    ssh = await startGitSshServer({ repositories: sshRemotes, authorizedKeys: [ PROTECTED_KEY_PUBLIC ] });
    git = await startGitHttpServer({ repositories: httpsRemotes, pushers: { [WRITER.username]: WRITER.password } });
  });

  test.afterAll(async () => {
    await Promise.all([ ssh?.close(), git?.close() ]);
    rmSync(root, { recursive: true, force: true });
  });

  const section = (page: Page) => page.getByRole('region', { name: 'Credentials' });
  const value = (page: Page, label: string) =>
    section(page).locator('div[uiKeyValue]', { has: page.locator('dt').getByText(label, { exact: true }) }).locator(
      'dd'
    );
  const dialog = (page: Page) => page.getByRole('dialog', { name: 'Repository credentials' });

  /** Opens the settings page of `id`, logging in first unless `loggedIn`, and waits for its credentials. */
  async function openSettings(page: Page, id: number, loggedIn = false): Promise<void> {
    const loaded = page.waitForResponse(response =>
      new URL(response.url()).pathname === `/api/v1/repositories/${id}/credentials`
    );
    await page.goto(`/repositories/${id}/settings`);
    if (!loggedIn) {
      await logIn(page);
    }
    await loaded;
  }

  test('AC-REPO-003.8: the Credentials section shows the credentials\' name, kind and, for an SSH key, its fingerprint, never the secret; Change credentials opens the repository credentials dialog', async ({ page, instance }) => {
    const { id: sshId } = await sshRepository(instance, ssh, sshRemotes, join(root, 'ssh', 'notes'));
    const { id: httpsId } = await addOverApi(instance, {
      name: 'handbook',
      remoteUrl: `${git.url}/handbook.git`,
      credentials: { mode: 'new-https', name: 'GitHub work', ...WRITER }
    });

    await openSettings(page, sshId);
    await expect(value(page, 'Name')).toHaveText('laptop');
    await expect(value(page, 'Kind')).toHaveText('SSH key');
    await expect(value(page, 'Key type')).toHaveText('Ed25519');
    await expect(value(page, 'Fingerprint')).toHaveText('SHA256:8tMSEvGb0Os35JCRb/xgaMxvTHbF9IrQMdoUVq/+tX8');
    await expect(value(page, 'Passphrase')).toHaveText('Protected');
    let html = await page.content();
    expect(html).not.toContain('PRIVATE KEY');
    expect(html).not.toContain(PROTECTED_KEY_PASSPHRASE);

    await openSettings(page, httpsId, true);
    await expect(value(page, 'Name')).toHaveText('GitHub work');
    await expect(value(page, 'Kind')).toHaveText('HTTPS credentials');
    await expect(value(page, 'Username')).toHaveText(WRITER.username);
    html = await page.content();
    expect(html).not.toContain(WRITER.password);

    await section(page).getByRole('button', { name: 'Change credentials' }).click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toContainText('GitHub work');
    // The radio is visually hidden, so its label is clicked.
    await dialog(page).getByRole('radiogroup').getByText('Add new credentials', { exact: true }).click();
    await dialog(page).getByLabel('Credentials name').fill('GitHub personal');
    await dialog(page).getByLabel('Username').fill(WRITER.username);
    await dialog(page).getByLabel('Password or token', { exact: true }).fill(WRITER.password);
    await dialog(page).getByRole('button', { name: 'Save' }).click();

    await expect(dialog(page)).toHaveCount(0);
    await expect(value(page, 'Name')).toHaveText('GitHub personal');
    expect(await page.content()).not.toContain(WRITER.password);
  });

  test('Cancel in the dialog changes nothing, and the section has no accessibility violations', async ({ page, instance }) => {
    const [ id ] = seed(instance.dataDir, { repositories: [ { userId: ADMIN_ID, name: 'public' } ] }).repositoryIds;
    await openSettings(page, id);

    await expect(section(page)).toContainText('No credentials (public repository)');
    expect((await new AxeBuilder({ page }).include('repo-credentials-in-use').analyze()).violations).toEqual([]);
    await section(page).getByRole('button', { name: 'Change credentials' }).click();
    await expect(dialog(page)).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();

    await expect(dialog(page)).toHaveCount(0);
    await expect(section(page)).toContainText('No credentials (public repository)');
    await expect(section(page).getByRole('button', { name: 'Change credentials' })).toBeFocused();
  });

  test('offers Change credentials for a failed clone', async ({ page, instance }) => {
    const [ id ] = seed(instance.dataDir, {
      repositories: [ { userId: ADMIN_ID, name: 'failed-one', status: 'error', errorCode: 'clone-failed' } ]
    }).repositoryIds;
    await openSettings(page, id);

    await section(page).getByRole('button', { name: 'Change credentials' }).click();
    await expect(dialog(page)).toBeVisible();
  });
});

test.describe('Retry clone and Clone again', () => {
  test.use({ instanceOptions: { onboarded: true, gitCaFile: TEST_CERTIFICATE_FILE } });

  let root: string;
  let git: GitHttpServer;
  let publicGit: GitHttpServer;
  /** Whether the private remote fails every clone, while its access checks still succeed; at first in every test. */
  let broken = true;
  const READER = { username: 'reader', password: 'pull-token-0123' };

  test.beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'front-burner-web-e2e-retry-'));
    mkdirSync(join(root, 'private'));
    mkdirSync(join(root, 'public'));
    git = await startGitHttpServer({
      repositories: { 'handbook.git': createHandbookRemote(join(root, 'private')) },
      users: { [READER.username]: READER.password },
      refuseFetch: () => broken
    });
    publicGit = await startGitHttpServer({
      repositories: { 'handbook.git': createHandbookRemote(join(root, 'public')) }
    });
  });

  test.beforeEach(() => {
    broken = true;
  });

  test.afterAll(async () => {
    await Promise.all([ git?.close(), publicGit?.close() ]);
    rmSync(root, { recursive: true, force: true });
  });

  const status = (page: Page) => page.getByRole('region', { name: 'Status' });
  const credentials = (page: Page) => page.getByRole('region', { name: 'Credentials' });
  const repository = (page: Page) => page.locator('.repository');

  /** Logs in at the settings page of `id` and waits for its details. */
  async function openSettings(page: Page, id: number): Promise<void> {
    const loaded = page.waitForResponse(response =>
      new URL(response.url()).pathname === `/api/v1/repositories/${id}/details`
    );
    await page.goto(`/repositories/${id}/settings`);
    await logIn(page);
    await loaded;
  }

  test('AC-REPO-003.4: a failed clone shows "Clone failed" and, under Details, the git error without secrets and with the request ID; Retry clone clones again with the same settings, and changing the credentials first is possible', async ({ page, instance }) => {
    const token = await adminAuthToken(instance.url);
    const added = await api(instance.url, token, 'POST', '/api/v1/repositories', {
      name: 'handbook',
      remoteUrl: `${git.url}/handbook.git`,
      cloneMode: 'full',
      credentials: { mode: 'new-https', name: 'GitHub work', ...READER }
    });
    expect(added.status).toBe(201);
    const id = added.body['id'] as number;
    await expect.poll(async () =>
      (await api(instance.url, token, 'GET', `/api/v1/repositories/${id}/details`)).body['summary']
    ).toMatchObject({ status: 'error', error: 'clone-failed' });

    await openSettings(page, id);
    await expect(status(page)).toContainText('Clone failed');
    await status(page).getByRole('button', { name: 'Details' }).click();
    await expect(status(page).locator('pre.message')).not.toBeEmpty();
    await expect(status(page).locator('.request code')).not.toBeEmpty();
    expect(await page.content()).not.toContain(READER.password);

    // Other credentials first (RM-11): saved with the repository, and used by the retry.
    await credentials(page).getByRole('button', { name: 'Change credentials' }).click();
    const dialog = page.getByRole('dialog', { name: 'Repository credentials' });
    await dialog.getByRole('radiogroup').getByText('Add new credentials', { exact: true }).click();
    await dialog.getByLabel('Credentials name').fill('GitHub personal');
    await dialog.getByLabel('Username').fill(READER.username);
    await dialog.getByLabel('Password or token', { exact: true }).fill(READER.password);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(credentials(page)).toContainText('GitHub personal');

    broken = false;
    await status(page).getByRole('button', { name: 'Retry clone' }).click();

    await expect(repository(page)).toContainText('Ready', { timeout: 30_000 });
    await expect(repository(page).getByRole('link', { name: 'Open handbook' })).toBeVisible();
    await expect(status(page)).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Clone details' })).toContainText('Full clone');
    await expect(credentials(page)).toContainText('GitHub personal');
  });

  test('AC-REPO-003.5: deleting a working copy\'s directory while the backend is stopped shows "Working copy is missing or damaged" after the next start; Clone again warns about lost work, clones it, and keeps the repository\'s name and commit author override', async ({ page, instance }) => {
    const { id, dir } = await addOverApi(instance, {
      name: 'handbook',
      remoteUrl: `${publicGit.url}/handbook.git`,
      credentials: { mode: 'none' }
    });
    const override = { name: 'Ada Lovelace', email: 'ada@example.com' };
    let token = await adminAuthToken(instance.url);
    expect((await api(instance.url, token, 'PUT', `/api/v1/repositories/${id}/commit-author`, override)).status)
      .toBe(200);

    await instance.restart(() => rmSync(dir, { recursive: true, force: true }));

    await openSettings(page, id);
    await expect(status(page)).toContainText('Working copy is missing or damaged');
    await status(page).getByRole('button', { name: 'Clone again' }).click();
    const warning = page.getByRole('dialog', { name: 'Clone handbook again?' });
    await expect(warning).toContainText('Any changes and commits that were only in the old working copy are lost.');
    await warning.getByRole('button', { name: 'Clone again' }).click();

    await expect(repository(page)).toContainText('Ready', { timeout: 30_000 });
    await expect(repository(page)).toContainText('handbook');
    token = await adminAuthToken(instance.url);
    const author = await api(instance.url, token, 'GET', `/api/v1/repositories/${id}/commit-author`);
    expect(author.body).toMatchObject({ author: override, source: 'override' });
  });

  test('cancelling the warning changes nothing, and the section has no accessibility violations', async ({ page, instance }) => {
    const [ id ] = seed(instance.dataDir, {
      repositories: [ { userId: ADMIN_ID, name: 'damaged', status: 'error', errorCode: 'working-copy-missing' } ]
    }).repositoryIds;
    await openSettings(page, id);

    expect((await new AxeBuilder({ page }).include('repo-clone-status').analyze()).violations).toEqual([]);
    await status(page).getByRole('button', { name: 'Clone again' }).click();
    const warning = page.getByRole('dialog', { name: 'Clone damaged again?' });
    await warning.getByRole('button', { name: 'Cancel' }).click();

    await expect(warning).toHaveCount(0);
    await expect(status(page)).toContainText('Working copy is missing or damaged');
    await expect(status(page).getByRole('button', { name: 'Clone again' })).toBeFocused();
  });
});

test.describe('the Commit author section', () => {
  const ADMIN_AUTHOR = `${TEST_ADMIN.displayName} <${TEST_ADMIN.email}>`;
  const OVERRIDE = { name: 'Ada Lovelace', email: 'ada@example.com' };
  const OVERRIDE_AUTHOR = `${OVERRIDE.name} <${OVERRIDE.email}>`;

  const section = (page: Page) => page.getByRole('region', { name: 'Commit author' });
  const dialog = (page: Page) => page.getByRole('dialog', { name: 'Commit author for this repository' });
  const changesButton = (page: Page) =>
    page.getByRole('toolbar', { name: 'Tool windows' }).getByRole('button', { name: /^Changes/ });
  const changesPane = (page: Page) => page.getByRole('region', { name: 'Changes', exact: true });

  /** Two ready repositories of the handbook fixture, with their working copies. */
  function handbooks(instance: { dataDir: string; }): { id: number; dir: string; }[] {
    return seed(instance.dataDir, {
      repositories: [
        { userId: ADMIN_ID, name: 'alpha', workingCopy: 'handbook' },
        { userId: ADMIN_ID, name: 'beta', workingCopy: 'handbook' }
      ]
    }).repositoryIds.map(id => ({ id, dir: join(instance.dataDir, 'repos', String(ADMIN_ID), String(id)) }));
  }

  /** Opens the settings page of `id`, logging in first unless `loggedIn`, and waits for the author in use. */
  async function openSettings(page: Page, id: number, loggedIn = true): Promise<void> {
    const loaded = page.waitForResponse(response =>
      new URL(response.url()).pathname === `/api/v1/repositories/${id}/commit-author`
    );
    await page.goto(`/repositories/${id}/settings`);
    if (!loggedIn) {
      await logIn(page);
    }
    await loaded;
  }

  /** Sets an override with **Use a different author for this repository**. */
  async function setOverride(page: Page): Promise<void> {
    await section(page).getByRole('button', { name: 'Use a different author for this repository' }).click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByRole('radiogroup')).toHaveCount(0);
    await dialog(page).getByLabel('Name').fill(OVERRIDE.name);
    await dialog(page).getByLabel('Email').fill(OVERRIDE.email);
    await dialog(page).getByRole('button', { name: 'Save' }).click();
    await expect(dialog(page)).toHaveCount(0);
  }

  /** Changes a file of the working copy and commits it from the repository screen; returns the commit's author. */
  async function commitIn(page: Page, repository: { id: number; dir: string; }, text: string): Promise<string> {
    writeFileSync(join(repository.dir, 'README.md'), `# ${text}\n`);
    await page.goto(`/repositories/${repository.id}`);
    await expect(changesButton(page)).toHaveAccessibleName('Changes (1)');
    if (await changesButton(page).getAttribute('aria-pressed') === 'false') {
      await changesButton(page).click();
    }
    await changesPane(page).getByRole('textbox', { name: 'Commit message' }).fill(text);
    await changesPane(page).getByRole('button', { name: 'Commit 1 file', exact: true }).click();
    await expect(changesPane(page).getByText('No changes since the last commit.')).toBeVisible();
    return gitIn(repository.dir, 'log', '-1', '--format=%an <%ae>').trim();
  }

  test('AC-REPO-003.9: the Commit author section shows the author in use and switches between an override and the default', async ({ page, instance }) => {
    const [ alpha ] = handbooks(instance);
    await openSettings(page, alpha.id, false);

    await expect(section(page)).toContainText(`Commits use ${ADMIN_AUTHOR}`);
    await expect(section(page)).toContainText('Your default commit author');
    await expect(section(page).getByRole('button', { name: 'Use my default' })).toHaveCount(0);

    await setOverride(page);
    await expect(section(page)).toContainText(`Commits use ${OVERRIDE_AUTHOR}`);
    await expect(section(page)).toContainText('Only for this repository');

    // Still there after a reload: the backend keeps it.
    await openSettings(page, alpha.id);
    await expect(section(page)).toContainText(`Commits use ${OVERRIDE_AUTHOR}`);

    await section(page).getByRole('button', { name: 'Use my default' }).click();
    await expect(section(page)).toContainText(`Commits use ${ADMIN_AUTHOR}`);
    await expect(section(page)).toContainText('Your default commit author');
    await expect(section(page).getByRole('button', { name: 'Use my default' })).toHaveCount(0);
  });

  test('AC-GIT-001.5: setting an override for repository A makes commits in A use it, while commits in repository B keep using the default; Use my default in A brings back the default', async ({ page, instance }) => {
    test.slow();
    await confirmCommitAuthor(instance.url);
    const [ alpha, beta ] = handbooks(instance);
    await openSettings(page, alpha.id, false);
    await setOverride(page);
    await expect(section(page)).toContainText('Only for this repository');

    expect(await commitIn(page, alpha, 'First in alpha')).toBe(OVERRIDE_AUTHOR);
    expect(await commitIn(page, beta, 'First in beta')).toBe(ADMIN_AUTHOR);

    await openSettings(page, alpha.id);
    await section(page).getByRole('button', { name: 'Use my default' }).click();
    await expect(section(page)).toContainText('Your default commit author');

    expect(await commitIn(page, alpha, 'Second in alpha')).toBe(ADMIN_AUTHOR);
  });

  test('cancelling the dialog changes nothing, and the section has no accessibility violations', async ({ page, instance }) => {
    const [ alpha ] = handbooks(instance);
    await openSettings(page, alpha.id, false);
    await expect(section(page)).toContainText(`Commits use ${ADMIN_AUTHOR}`);

    expect((await new AxeBuilder({ page }).include('repo-repository-commit-author').analyze()).violations).toEqual([]);
    const change = section(page).getByRole('button', { name: 'Use a different author for this repository' });
    await change.click();
    await dialog(page).getByLabel('Name').fill(OVERRIDE.name);
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();

    await expect(dialog(page)).toHaveCount(0);
    await expect(section(page)).toContainText(`Commits use ${ADMIN_AUTHOR}`);
    await expect(change).toBeFocused();
  });

  test('follows a change of the default on the Preferences page in another tab', async ({ page, instance, context }) => {
    const [ alpha ] = handbooks(instance);
    await openSettings(page, alpha.id, false);
    await expect(section(page)).toContainText(`Commits use ${ADMIN_AUTHOR}`);

    const preferences = await context.newPage();
    await preferences.goto('/preferences');
    await preferences.getByRole('button', { name: 'Edit' }).click();
    await preferences.getByLabel('Name').fill(OVERRIDE.name);
    await preferences.getByLabel('Email').fill(OVERRIDE.email);
    await preferences.getByRole('button', { name: 'Save' }).click();
    await expect(preferences.getByRole('button', { name: 'Edit' })).toBeVisible();

    await expect(section(page)).toContainText(`Commits use ${OVERRIDE_AUTHOR}`);
    await expect(section(page)).toContainText('Your default commit author');
  });
});

test.describe('repository warnings', () => {
  test.use({ instanceOptions: { onboarded: true, gitCaFile: TEST_CERTIFICATE_FILE } });

  let root: string;
  let ssh: GitSshServer;
  let git: GitHttpServer;
  const sshRemotes: Record<string, string> = {};
  const httpsRemotes: Record<string, string> = {};
  /** Who may push; anyone may read, as from a public repository. A test takes the writer's right away. */
  const pushers: Record<string, string> = {};
  const WRITER = { username: 'writer', password: 'push-token' };
  let next = 0;

  test.beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'front-burner-web-e2e-warnings-'));
    ssh = await startGitSshServer({ repositories: sshRemotes, authorizedKeys: [ PROTECTED_KEY_PUBLIC ] });
    git = await startGitHttpServer({ repositories: httpsRemotes, pushers });
  });

  test.beforeEach(() => {
    pushers[WRITER.username] = WRITER.password;
  });

  test.afterAll(async () => {
    await Promise.all([ ssh?.close(), git?.close() ]);
    rmSync(root, { recursive: true, force: true });
  });

  const warnings = (page: Page) => page.getByRole('region', { name: 'Warnings' });
  const statusOf = (page: Page) => page.locator('repo-repository-settings shell-repository-status');
  const dashboardEntry = (page: Page, name: string) =>
    page.locator('dash-repository-entry', { has: page.getByRole('link', { name, exact: true }) });

  /** A repository of a new remote over HTTPS with the writer's token, and one commit to push. */
  async function addHandbook(instance: { url: string; dataDir: string; }): Promise<{ id: number; name: string; }> {
    const name = `handbook-${next++}`;
    mkdirSync(join(root, name), { recursive: true });
    httpsRemotes[`${name}.git`] = createHandbookRemote(join(root, name));
    const { id, dir } = await addOverApi(instance, {
      name,
      remoteUrl: `${git.url}/${name}.git`,
      credentials: { mode: 'new-https', name: 'writer token', ...WRITER }
    });
    gitIn(dir, 'commit', '-q', '--allow-empty', '-m', 'second');
    return { id, name };
  }

  /**
   * Runs `operation` (`push` or `fetch`) over the API and waits for its job to
   * end; answers its outcome's kind, such as `pushed` or `failed`, with a
   * failure's code.
   */
  async function runJob(url: string, id: number, operation: 'push' | 'fetch'): Promise<string> {
    const token = await adminAuthToken(url);
    const started = await api(url, token, 'POST', `/api/v1/repositories/${id}/git/${operation}`);
    expect(started.status).toBe(202);
    const jobId = started.body['jobId'] as number;
    let ended = '';
    await expect.poll(async () => {
      const state = await api(url, token, 'GET', `/api/v1/repositories/${id}/git/jobs/${jobId}`);
      const outcome = state.body['outcome'] as { kind: string; code?: string; } | null;
      ended = outcome === null
        ? (state.body['status'] === 'cancelled' ? 'cancelled' : '')
        : [ outcome.kind, outcome.code ].filter(Boolean).join(' ');
      return ended;
    }).not.toBe('');
    return ended;
  }

  test('AC-REPO-003.6: a repository whose last push was refused shows "Credentials refused" on the dashboard, this page and its settings page, and can still be opened; a successful background fetch does not remove the warning, and the next successful push does', async ({ page, instance }) => {
    const { id, name } = await addHandbook(instance);
    delete pushers[WRITER.username];
    expect(await runJob(instance.url, id, 'push')).toBe('failed credentials-refused');

    // The dashboard: the label, the repository still opens, and Settings leads to the fix.
    await page.goto('/');
    await logIn(page);
    const entry = dashboardEntry(page, name);
    await expect(entry).toContainText('Credentials refused');
    await expect(entry.getByRole('link', { name, exact: true })).toHaveAttribute('href', `/repositories/${id}`);
    await expect(entry.getByRole('link', { name: `Settings of ${name}` })).toHaveAttribute(
      'href',
      `/repositories/${id}/settings`
    );

    // The repository management page: the label, and Open.
    await page.goto('/repositories');
    const listed = entries(page).filter({ has: page.getByRole('link', { name, exact: true }) });
    await expect(listed).toContainText('Credentials refused');
    await expect(listed.getByRole('link', { name: `Open ${name}` })).toBeVisible();

    // The settings page: the label, Open, and the fix.
    await listed.getByRole('link', { name, exact: true }).click();
    await expect(statusOf(page)).toContainText('Credentials refused');
    await expect(page.getByRole('link', { name: `Open ${name}` })).toBeVisible();
    await expect(warnings(page)).toContainText('the remote refused this repository\'s credentials');
    await expect(warnings(page).getByRole('button', { name: 'Fix credentials' })).toBeVisible();

    // A fetch succeeds, as anyone may read: the push's warning stays.
    expect(await runJob(instance.url, id, 'fetch')).toBe('fetched');
    await page.reload();
    await expect(statusOf(page)).toContainText('Credentials refused');

    // The next push succeeds: the warning goes, without a reload.
    pushers[WRITER.username] = WRITER.password;
    gitIn(
      join(instance.dataDir, 'repos', String(ADMIN_ID), String(id)),
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'third'
    );
    expect(await runJob(instance.url, id, 'push')).toBe('pushed');
    await expect(statusOf(page)).not.toContainText('Credentials refused');
    await expect(warnings(page)).toHaveCount(0);
  });

  test('AC-REPO-003.7: after a backend restart, a repository with a passphrase-protected key shows "Key locked" with Unlock', async ({ page, instance }) => {
    const { id } = await sshRepository(instance, ssh, sshRemotes, join(root, 'ssh', 'locked'));
    await instance.restart();

    await page.goto(`/repositories/${id}/settings`);
    await logIn(page);
    await expect(statusOf(page)).toContainText('Key locked');
    await expect(warnings(page)).toContainText('Key locked');
    expect((await new AxeBuilder({ page }).include('repo-repository-warnings').analyze()).violations).toEqual([]);

    await warnings(page).getByRole('button', { name: 'Unlock' }).click();
    const unlock = page.getByRole('dialog', { name: 'Unlock laptop' });
    await expect(unlock).toContainText('SHA256:8tMSEvGb0Os35JCRb/xgaMxvTHbF9IrQMdoUVq/+tX8');
    await unlock.getByLabel('Passphrase').fill(PROTECTED_KEY_PASSPHRASE);
    await unlock.getByRole('button', { name: 'Unlock' }).click();

    await expect(unlock).toHaveCount(0);
    await expect(statusOf(page)).not.toContainText('Key locked');
    await expect(warnings(page)).toHaveCount(0);
  });

  test('cancelling a fix changes nothing, and the warnings fit a phone', async ({ page, instance, isMobile }) => {
    const { id } = await sshRepository(instance, ssh, sshRemotes, join(root, 'ssh', `cancel-${next++}`));
    await page.goto(`/repositories/${id}/settings`);
    await logIn(page);

    const button = warnings(page).getByRole('button', { name: 'Unlock' });
    await button.click();
    await page.getByRole('dialog', { name: 'Unlock laptop' }).getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(warnings(page)).toContainText('Key locked');
    await expect(button).toBeFocused();
    if (isMobile) {
      expect(await fitsWidth(page)).toBe(true);
    }
  });
});
