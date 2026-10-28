import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
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
import { logIn } from './support/instance';

test.use({ instanceOptions: { onboarded: true, gitCaFile: TEST_CERTIFICATE_FILE } });

const TOKEN = 'web-e2e-git-token';

let root: string;
let publicGit: GitHttpServer;
let privateGit: GitHttpServer;

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'front-burner-web-e2e-git-'));
  const repositories = { 'handbook.git': createHandbookRemote(root) };
  publicGit = await startGitHttpServer({ repositories });
  privateGit = await startGitHttpServer({ repositories, users: { alice: TOKEN } });
});

test.afterAll(async () => {
  await Promise.all([ publicGit?.close(), privateGit?.close() ]);
  rmSync(root, { recursive: true, force: true });
});

const publicUrl = () => `${publicGit.url}/handbook.git`;
const privateUrl = () => `${privateGit.url}/handbook.git`;

const remoteUrl = (page: Page) => page.getByLabel('Remote URL');
const repositoryName = (page: Page) => page.getByLabel('Repository name');
const radio = (page: Page, name: string) => page.getByRole('radio', { name, exact: true });
const submit = (page: Page) => page.getByRole('button', { name: 'Add repository' });

/** Chooses an option of a segmented control: the radio is visually hidden, so its label is clicked. */
async function choose(page: Page, name: string): Promise<void> {
  await page.getByRole('radiogroup').getByText(name, { exact: true }).click();
  await expect(radio(page, name)).toBeChecked();
}
const cancel = (page: Page) => page.getByRole('button', { name: 'Cancel' });

/** Logs in and opens the Add repository page from the dashboard (AC-REPO-001.1). */
async function openAddRepository(page: Page): Promise<void> {
  await page.goto('/');
  await logIn(page);
  await page.getByRole('link', { name: 'Add repository' }).first().click();
  await expect(page.getByRole('heading', { name: 'Add repository', level: 1 })).toBeVisible();
}

/** Opens the page again while logged in, as a second visit. */
async function revisit(page: Page): Promise<void> {
  await page.goto('/repositories/new');
  await expect(page.getByRole('heading', { name: 'Add repository', level: 1 })).toBeVisible();
}

async function enterUrl(page: Page, url: string): Promise<void> {
  await remoteUrl(page).fill(url);
  await remoteUrl(page).blur();
}

function fitsWidth(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

async function axeViolations(page: Page) {
  return (await new AxeBuilder({ page }).analyze()).violations;
}

test.describe('Add repository, against a git server', () => {
  test('AC-REPO-001.1, AC-REPO-001.4 and AC-REPO-001.15: the page, the name from the URL, the protocols and no level dropdown', async ({ page }) => {
    await openAddRepository(page);
    await expect(page).toHaveURL(/\/repositories\/new$/);
    await expect(page).toHaveTitle('Add repository · Front Burner');
    const breadcrumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(breadcrumbs.getByRole('link', { name: 'Repositories' })).toHaveAttribute('href', '/repositories');
    await expect(breadcrumbs.getByText('Add repository')).toBeVisible();
    await expect(page.getByText('Enter the remote URL first')).toBeVisible();

    await enterUrl(page, 'https://github.com/acme/handbook.git');
    await expect(repositoryName(page)).toHaveValue('handbook');
    await expect(radio(page, 'Add new credentials')).toBeChecked();
    await expect(radio(page, 'No credentials (public repository)')).toBeVisible();

    await enterUrl(page, 'git@github.com:acme/handbook.git');
    await expect(radio(page, 'Paste a key')).toBeChecked();
    await expect(radio(page, 'Generate a key')).toBeVisible();

    await repositoryName(page).fill('Team handbook');
    await enterUrl(page, 'git@github.com:acme/wiki.git');
    await expect(repositoryName(page)).toHaveValue('Team handbook');

    // The administrator is allowed Advanced only (AC-REPO-001.15).
    await expect(page.getByRole('combobox', { name: 'Git control level' })).toHaveCount(0);
  });

  test('AC-REPO-001.1: a visitor who is not logged in is sent to the login page', async ({ page }) => {
    await page.goto('/repositories/new');

    await expect(page).toHaveURL(/\/login\?returnUrl=%2Frepositories%2Fnew$/);
  });

  test('AC-REPO-001.2, AC-REPO-001.7, AC-REPO-001.18 and AC-DASH-001.14: a public repository, submitted twice, lands on the dashboard as Cloning', async ({ page }) => {
    await openAddRepository(page);
    await enterUrl(page, publicUrl());
    await choose(page, 'No credentials (public repository)');
    await expect(submit(page)).not.toHaveAttribute('aria-disabled');

    await submit(page).dblclick();

    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole('region', { name: 'Notifications' }).getByText('Cloning handbook. It will be ready to open soon.')
    ).toBeVisible();
    const entries = page.locator('dash-repository-entry');
    await expect(entries).toHaveCount(1);
    // Openable once the clone ends, without a reload (AC-DASH-001.14).
    await expect(entries.getByRole('link', { name: 'handbook' })).toBeVisible({ timeout: 30_000 });

    // The message shows once: not again on reload.
    await page.reload();
    await expect(entries.getByRole('link', { name: 'handbook' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Notifications' }).getByText(/^Cloning handbook/)).toHaveCount(0);

    // Nothing was saved to the profile (AC-REPO-001.7).
    await revisit(page);
    await enterUrl(page, publicUrl());
    await expect(radio(page, 'Use saved credentials')).toHaveCount(0);
  });

  test('AC-REPO-001.7: no credentials for a private repository is refused on the credentials', async ({ page, monitor }) => {
    await openAddRepository(page);
    await enterUrl(page, privateUrl());
    await choose(page, 'No credentials (public repository)');

    await submit(page).click();

    await expect(page.getByText('This repository needs credentials.')).toBeVisible();
    await expect(page).toHaveURL(/\/repositories\/new$/);
    drainFailedRequests(monitor, '/api/v1/repositories');
  });

  test('AC-REPO-001.6: new credentials are offered, preselected, on the next visit', async ({ page }) => {
    await openAddRepository(page);
    await enterUrl(page, privateUrl());
    await expect(radio(page, 'Use saved credentials')).toHaveCount(0);
    await page.getByLabel('Credentials name').fill('Local git');
    await page.getByLabel('Username').fill('alice');
    await page.getByLabel('Password or token', { exact: true }).fill(TOKEN);

    await submit(page).click();
    await expect(page).toHaveURL(/\/$/);

    await revisit(page);
    await enterUrl(page, privateUrl());
    await expect(radio(page, 'Use saved credentials')).toBeChecked();
    await expect(page.getByRole('combobox', { name: 'Saved credentials' })).toHaveText(/Local git \(alice\)/);
  });

  test('AC-REPO-001.14: a single branch lists the branches with the default preselected', async ({ page }) => {
    await openAddRepository(page);
    await enterUrl(page, publicUrl());
    await choose(page, 'No credentials (public repository)');

    await choose(page, 'Single branch');

    await expect(page.getByRole('combobox', { name: 'Branch' })).toHaveText(/main/);
    await expect(page.getByText('A single-branch clone contains only the chosen branch')).toBeVisible();
    await expect(submit(page)).toHaveAttribute('aria-disabled', 'true');
    await page.getByRole('checkbox', { name: 'I understand' }).check();
    await expect(submit(page)).not.toHaveAttribute('aria-disabled');
    expect(await axeViolations(page)).toEqual([]);
  });

  test('AC-REPO-001.20: Cancel asks after a change and leaves an untouched form at once', async ({ page }) => {
    await openAddRepository(page);
    await cancel(page).click();
    await expect(page).toHaveURL(/\/$/);

    await page.getByRole('link', { name: 'Add repository' }).first().click();
    await repositoryName(page).fill('handbook');
    await cancel(page).click();
    const dialog = page.getByRole('dialog', { name: 'Discard your changes?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page).toHaveURL(/\/repositories\/new$/);
    await expect(repositoryName(page)).toHaveValue('handbook');

    await cancel(page).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Discard' }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('AC-REPO-001.20: Back asks first, and Keep editing keeps the way back', async ({ page }) => {
    await openAddRepository(page);
    await repositoryName(page).fill('handbook');

    await page.goBack();
    await page.getByRole('dialog', { name: 'Discard your changes?' }).getByRole('button', { name: 'Keep editing' })
      .click();
    await expect(page).toHaveURL(/\/repositories\/new$/);
    await expect(repositoryName(page)).toHaveValue('handbook');

    await page.goBack();
    await page.getByRole('dialog', { name: 'Discard your changes?' }).getByRole('button', { name: 'Discard' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
  });

  test('AC-REPO-001.26: usable at 320 px, with no axe violations', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await openAddRepository(page);
    expect(await fitsWidth(page)).toBe(true);
    expect(await axeViolations(page)).toEqual([]);

    await enterUrl(page, 'http://example.com/handbook.git');
    await repositoryName(page).fill(' ');
    await repositoryName(page).blur();
    await expect(page.getByText('Use an HTTPS or SSH URL')).toBeVisible();
    await expect(page.getByText('Enter a name')).toBeVisible();
    expect(await fitsWidth(page)).toBe(true);
    expect(await axeViolations(page)).toEqual([]);

    await enterUrl(page, publicUrl());
    await choose(page, 'No credentials (public repository)');
    await choose(page, 'Single branch');
    await expect(page.getByRole('combobox', { name: 'Branch' })).toHaveText(/main/);
    expect(await fitsWidth(page)).toBe(true);
  });
});

const lockedKey = {
  id: 3,
  name: 'Laptop',
  keyType: 'ed25519',
  fingerprint: 'SHA256:lockedfingerprint',
  passphraseProtected: true,
  unlocked: false,
  generated: false,
  missing: false
};

const generated = {
  key: { ...lockedKey, id: 9, name: 'Front Burner', passphraseProtected: false, generated: true },
  publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGenerated front-burner@localhost'
};

const hostKey = {
  host: 'git.example.com',
  port: 22,
  type: 'ssh-ed25519',
  key: 'AAAAC3NzaC1lZDI1NTE5AAAAIH',
  fingerprint: 'SHA256:examplefingerprint'
};

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const apiError = (code: string, params: Record<string, unknown> = {}, fields?: unknown[]) => ({
  code,
  params,
  requestId: 'web-e2e',
  message: code,
  ...(fields ? { fields } : {})
});

test.describe('Add repository over SSH, with the API stubbed', () => {
  test('AC-REPO-001.8 and AC-REPO-001.9: saved keys, a protected one marked, its passphrase, then unlocked', async ({ page }) => {
    await page.route('**/api/v1/credentials', route => json(route, 200, { https: [], sshKeys: [ lockedKey ] }));
    await page.route('**/api/v1/credentials/ssh-keys/3/unlock', route => route.fulfill({ status: 204 }));
    await openAddRepository(page);

    await enterUrl(page, 'git@git.example.com:acme/handbook.git');
    await expect(radio(page, 'Use a saved key')).toBeChecked();
    await page.getByRole('combobox', { name: 'Saved key' }).click();
    const option = page.getByRole('option', { name: /Laptop/ });
    await expect(option).toContainText('ed25519 SHA256:lockedfingerprint');
    await expect(option).toContainText('Passphrase');
    await option.click();

    const passphrase = page.getByLabel('Passphrase', { exact: true });
    await expect(passphrase).toHaveAttribute('type', 'password');
    await passphrase.fill('correct horse');
    await passphrase.blur();

    await expect(page.getByText('Unlocked for this session')).toBeVisible();
    await expect(page.getByLabel('Passphrase', { exact: true })).toHaveCount(0);
  });

  test('AC-REPO-001.8: without saved keys, paste or generate', async ({ page }) => {
    await openAddRepository(page);

    await enterUrl(page, 'git@git.example.com:acme/handbook.git');

    await expect(radio(page, 'Use a saved key')).toHaveCount(0);
    await expect(radio(page, 'Paste a key')).toBeChecked();
    await expect(page.getByLabel('Private key')).toBeVisible();
  });

  test('AC-REPO-001.12: a generated key, Copy, the checkbox gate and AR-42\'s hint', async ({ page, monitor }) => {
    // Clipboard permissions differ between browsers: record what is copied instead.
    await page.addInitScript(() => {
      const copied: string[] = [];
      Object.defineProperty(window, 'copied', { value: copied });
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: (text: string) => Promise.resolve(void copied.push(text)) }
      });
    });
    await page.route('**/api/v1/credentials/ssh-keys/generate', route => json(route, 201, generated));
    await page.route('**/api/v1/repositories', route =>
      route.request().method() === 'POST'
        ? json(
          route,
          400,
          apiError('validation-failed', {}, [
            { path: 'credentials', code: 'credentials-refused', params: { generatedKey: true } }
          ])
        )
        : route.fallback());
    await openAddRepository(page);
    await enterUrl(page, 'git@git.example.com:acme/handbook.git');
    await choose(page, 'Generate a key');
    // Paste a key has a Key name too: wait for the generate form.
    await expect(page.getByRole('button', { name: 'Generate' })).toBeVisible();
    await page.getByLabel('Key name').fill('Front Burner');

    await page.getByRole('button', { name: 'Generate' }).click();

    await expect(page.getByLabel('Public key')).toHaveValue(generated.publicKey);
    await expect(page.getByText('Add this key to your git server')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Generate' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Copy' }).click();
    await expect(page.getByRole('region', { name: 'Notifications' }).getByText('Copied')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { copied: string[]; }).copied)).toEqual([
      generated.publicKey
    ]);
    await expect(submit(page)).toHaveAttribute('aria-disabled', 'true');
    await page.getByRole('checkbox', { name: 'I have added this key to my git server' }).check();
    await expect(submit(page)).not.toHaveAttribute('aria-disabled');

    await submit(page).click();

    await expect(
      page.getByText('These credentials can\'t access the repository. Has the key been added to your git server?')
    ).toBeVisible();
    drainFailedRequests(monitor, '/api/v1/repositories');
  });

  test('AC-REPO-001.13: an unknown host asks to be trusted; Trust repeats the request', async ({ page, monitor }) => {
    let adds = 0;
    let trusted: unknown;
    await page.route('**/api/v1/repositories', route => {
      if (route.request().method() !== 'POST') {
        return route.fallback();
      }
      adds++;
      return adds === 1
        ? json(route, 409, apiError('host-key-unknown', hostKey))
        : json(route, 201, {
          id: 1,
          name: 'handbook',
          remote: 'git.example.com/acme/handbook',
          status: 'cloning',
          error: null,
          warnings: [],
          lastAccessedAt: new Date().toISOString()
        });
    });
    await page.route('**/api/v1/known-hosts', route => {
      trusted = route.request().postDataJSON();
      return route.fulfill({ status: 204 });
    });
    await openAddRepository(page);
    await enterUrl(page, 'git@git.example.com:acme/handbook.git');
    await page.getByLabel('Key name').fill('Laptop');
    await page.getByLabel('Private key').fill('-----BEGIN OPENSSH PRIVATE KEY-----');

    await submit(page).click();

    const dialog = page.getByRole('dialog', { name: 'Do you trust this server?' });
    await expect(dialog).toContainText('git.example.com');
    await expect(dialog).toContainText('SHA256:examplefingerprint');
    await dialog.getByRole('button', { name: 'Trust' }).click();

    await expect(page).toHaveURL(/\/$/);
    expect(trusted).toEqual({ host: 'git.example.com', port: 22, type: 'ssh-ed25519', key: hostKey.key });
    expect(adds).toBe(2);
    drainFailedRequests(monitor, '/api/v1/repositories');
  });

  test('AC-REPO-001.13: Cancel leaves the form as it was', async ({ page, monitor }) => {
    await page.route(
      '**/api/v1/repositories',
      route =>
        route.request().method() === 'POST' ? json(route, 409, apiError('host-key-unknown', hostKey)) : route.fallback()
    );
    await openAddRepository(page);
    await enterUrl(page, 'git@git.example.com:acme/handbook.git');
    await page.getByLabel('Key name').fill('Laptop');
    await page.getByLabel('Private key').fill('-----BEGIN OPENSSH PRIVATE KEY-----');
    await page.getByLabel('Passphrase (optional)').fill('correct horse');

    await submit(page).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(/\/repositories\/new$/);
    await expect(page.getByLabel('Passphrase (optional)')).toHaveValue('correct horse');
    await expect(remoteUrl(page)).toHaveValue('git@git.example.com:acme/handbook.git');
    drainFailedRequests(monitor, '/api/v1/repositories');
  });
});
