import type { Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from './support/fixtures';
import {
  createHandbookRemote,
  type GitHttpServer,
  startGitHttpServer,
  TEST_CERTIFICATE_FILE
} from './support/git-http-server';
import { type Hands, keyboard, touch } from './support/hands';
import { adminAuthToken, logIn } from './support/instance';
import { api, workingCopyOf } from './support/repositories';

test.use({ instanceOptions: { onboarded: true, gitCaFile: TEST_CERTIFICATE_FILE } });

const USERNAME = 'ada';
/** The token the repository is added with; revoked before its clone asks for objects. */
const FIRST = 'first-token';
/** The token that replaces it on the settings page; revoked later too. */
const SECOND = 'second-token';
/** The token that **Fix credentials** puts in its place. */
const THIRD = 'third-token';

const heading = (page: Page, name: string) => page.getByRole('heading', { name, exact: true });
const entries = (page: Page) => page.locator('repo-repository-list-entry');
const entry = (page: Page, name: string) =>
  entries(page).filter({ has: page.getByRole('link', { name, exact: true }) });
const repository = (page: Page) => page.locator('.repository');
const statusOf = (page: Page) => page.locator('repo-repository-settings shell-repository-status');
const status = (page: Page) => page.getByRole('region', { name: 'Status' });
const credentials = (page: Page) => page.getByRole('region', { name: 'Credentials' });
const warnings = (page: Page) => page.getByRole('region', { name: 'Warnings' });
const removal = (page: Page) => page.getByRole('region', { name: 'Remove repository' });
const credentialsDialog = (page: Page) => page.getByRole('dialog', { name: 'Repository credentials' });
const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications' });

test.describe('exit criterion 11', () => {
  let root: string;
  let git: GitHttpServer;
  const remotes: Record<string, string> = {};
  /** Who may list the references, and who may fetch objects: a test revokes a token by changing both. */
  const users: Record<string, string> = {};
  const fetchers: Record<string, string> = {};
  let next = 0;

  test.beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'front-burner-web-e2e-walkthrough-'));
    git = await startGitHttpServer({ repositories: remotes, users, fetchers });
  });

  test.afterAll(async () => {
    await git?.close();
    rmSync(root, { recursive: true, force: true });
  });

  /** Only `token` works from now on: every other token of the user is revoked. */
  function onlyToken(token: string): void {
    users[USERNAME] = token;
    fetchers[USERNAME] = token;
  }

  /** Logs in at the repository management page and waits for its list. */
  async function openRepositories(page: Page, loggedIn: boolean): Promise<void> {
    const loaded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/repositories');
    await page.goto('/repositories');
    if (!loggedIn) {
      await logIn(page);
    }
    await loaded;
    await expect(heading(page, 'Repositories')).toBeVisible();
  }

  /** Opens the settings page of `name` from its entry on the repository management page. */
  async function openSettings(page: Page, hands: Hands, name: string): Promise<void> {
    await hands.press(entry(page, name).getByRole('link', { name, exact: true }));
    await expect(page).toHaveURL(/\/repositories\/\d+\/settings$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Settings');
  }

  /** Runs a fetch over the API, as the background fetch does, and answers its outcome, such as `fetched`. */
  async function fetchOverApi(url: string, id: number): Promise<string> {
    const token = await adminAuthToken(url);
    const started = await api(url, token, 'POST', `/api/v1/repositories/${id}/git/fetch`);
    expect(started.status).toBe(202);
    const jobId = started.body['jobId'] as number;
    let ended = '';
    await expect.poll(async () => {
      const state = await api(url, token, 'GET', `/api/v1/repositories/${id}/git/jobs/${jobId}`);
      const outcome = state.body['outcome'] as { kind: string; code?: string; } | null;
      ended = outcome === null ? '' : [ outcome.kind, outcome.code ].filter(Boolean).join(' ');
      return ended;
    }).not.toBe('');
    return ended;
  }

  /**
   * Exit criterion 11, in four rounds, from the repository management page:
   *
   * 1. a clone fails for a token revoked meanwhile: **Details**, **Change
   *    credentials**, **Retry clone**, **Open**;
   * 2. the next token is revoked too: "Credentials refused", **Fix
   *    credentials**, and the warning goes;
   * 3. the working copy is deleted while the backend is stopped: **Clone
   *    again**;
   * 4. a removal with an uncommitted file, which needs the name typed, sends a
   *    second device that has it open to the dashboard.
   */
  async function walkThrough(
    page: Page,
    hands: Hands,
    instance: { url: string; dataDir: string; restart(whileStopped?: () => void): Promise<void>; },
    newDevice: () => Promise<Page>
  ): Promise<void> {
    const name = `handbook-${next++}`;
    mkdirSync(join(root, name), { recursive: true });
    remotes[`${name}.git`] = createHandbookRemote(join(root, name));

    // Round 1: the access check passes with the first token, which is revoked before the clone fetches.
    users[USERNAME] = FIRST;
    fetchers[USERNAME] = SECOND;
    const token = await adminAuthToken(instance.url);
    const added = await api(instance.url, token, 'POST', '/api/v1/repositories', {
      name,
      remoteUrl: `${git.url}/${name}.git`,
      cloneMode: 'full',
      credentials: { mode: 'new-https', name: 'first token', username: USERNAME, password: FIRST }
    });
    expect(added.status).toBe(201);
    const id = added.body['id'] as number;
    await expect.poll(async () => (await api(instance.url, token, 'GET', `/api/v1/repositories/${id}`)).body['status'])
      .toBe('error');
    onlyToken(SECOND);

    await openRepositories(page, false);
    await expect(entry(page, name)).toContainText('Clone failed');
    await expect(entry(page, name).getByRole('link', { name: `Open ${name}` })).toHaveCount(0);
    await openSettings(page, hands, name);
    await expect(status(page)).toContainText('Clone failed');
    const details = status(page).getByRole('button', { name: 'Details' });
    await hands.press(details);
    await expect(details).toHaveAttribute('aria-expanded', 'true');
    await expect(status(page).locator('pre.message')).not.toBeEmpty();
    await expect(status(page).locator('.request code')).not.toBeEmpty();
    expect(await page.content()).not.toContain(FIRST);

    await hands.press(credentials(page).getByRole('button', { name: 'Change credentials' }));
    await expect(credentialsDialog(page)).toBeVisible();
    await hands.choose(credentialsDialog(page).getByRole('radiogroup'), 'Add new credentials');
    await hands.typeInto(credentialsDialog(page).getByLabel('Credentials name'), 'second token');
    await hands.typeInto(credentialsDialog(page).getByLabel('Username'), USERNAME);
    await hands.typeInto(credentialsDialog(page).getByLabel('Password or token', { exact: true }), SECOND);
    await hands.press(credentialsDialog(page).getByRole('button', { name: 'Save' }));
    await expect(credentialsDialog(page)).toHaveCount(0);
    await expect(credentials(page)).toContainText('second token');

    await hands.press(status(page).getByRole('button', { name: 'Retry clone' }));
    await expect(repository(page)).toContainText('Ready', { timeout: 30_000 });
    await expect(status(page)).toHaveCount(0);
    await hands.press(repository(page).getByRole('link', { name: `Open ${name}` }));
    await expect(page).toHaveURL(new RegExp(`/repositories/${id}$`));
    await expect(
      page.getByRole('toolbar', { name: 'Tool windows' }).getByRole('button', { name: 'Files', exact: true })
    ).toBeVisible();

    // Round 2: the second token is revoked, and the next fetch is refused.
    onlyToken(THIRD);
    expect(await fetchOverApi(instance.url, id)).toBe('failed credentials-refused');

    await openRepositories(page, true);
    await expect(entry(page, name)).toContainText('Credentials refused');
    await expect(entry(page, name).getByRole('link', { name: `Open ${name}` })).toBeVisible();
    await openSettings(page, hands, name);
    await expect(statusOf(page)).toContainText('Credentials refused');
    await hands.press(warnings(page).getByRole('button', { name: 'Fix credentials' }));
    await expect(credentialsDialog(page)).toBeVisible();
    await expect(credentialsDialog(page).getByRole('radio', { name: 'Update the token of second token' }))
      .toBeChecked();
    await expect(credentialsDialog(page).getByLabel('Username')).toHaveValue(USERNAME);
    await hands.typeInto(credentialsDialog(page).getByLabel('Password or token', { exact: true }), THIRD);
    await hands.press(credentialsDialog(page).getByRole('button', { name: 'Update' }));
    await expect(credentialsDialog(page)).toHaveCount(0);
    // The fix fetches at once: the warning goes without a reload.
    await expect(warnings(page)).toHaveCount(0);
    await expect(statusOf(page)).not.toContainText('Credentials refused');
    await expect(statusOf(page)).toContainText('Ready');

    // Round 3: the working copy is deleted while the backend is stopped.
    const dir = workingCopyOf(instance.dataDir, id);
    await instance.restart(() => rmSync(dir, { recursive: true, force: true }));

    await openRepositories(page, true);
    await expect(entry(page, name)).toContainText('Working copy is missing or damaged');
    await openSettings(page, hands, name);
    await hands.press(status(page).getByRole('button', { name: 'Clone again' }));
    const again = page.getByRole('dialog', { name: `Clone ${name} again?` });
    await expect(again).toContainText('Any changes and commits that were only in the old working copy are lost.');
    await hands.press(again.getByRole('button', { name: 'Clone again' }));
    await expect(again).toHaveCount(0);
    await expect(repository(page)).toContainText('Ready', { timeout: 30_000 });
    await expect(repository(page).getByRole('link', { name: `Open ${name}` })).toBeVisible();

    // Round 4: a removal with an uncommitted file, while a second device has the repository open.
    writeFileSync(join(dir, 'notes.md'), '# Notes\n');
    const second = await newDevice();
    const opened = second.waitForResponse(response => response.url().endsWith(`/api/v1/repositories/${id}/open`));
    await second.goto(`/repositories/${id}`);
    await logIn(second);
    await opened;

    await openRepositories(page, true);
    await openSettings(page, hands, name);
    await expect(removal(page)).toContainText(
      'This deletes its working copy on Front Burner. The remote is not changed.'
    );
    await hands.press(removal(page).getByRole('button', { name: 'Remove repository' }));
    const remove = page.getByRole('dialog', { name: `Remove ${name}?` });
    await expect(remove.getByRole('listitem')).toHaveText([ '1 uncommitted file' ]);
    const confirm = remove.getByRole('button', { name: 'Remove', exact: true });
    await expect(confirm).toHaveAttribute('aria-disabled', 'true');
    await hands.typeInto(remove.getByLabel(`Type ${name} to confirm`), name);
    await expect(confirm).not.toHaveAttribute('aria-disabled');
    await hands.press(confirm);

    await expect(page).toHaveURL(/\/repositories$/);
    await expect(toasts(page).getByText(`Repository ${name} removed.`)).toBeVisible();
    await expect(entries(page)).toHaveCount(0);
    // Without a reload: the second device goes to the dashboard, which does not list it.
    await expect(second).toHaveURL(new URL('/', instance.url).href);
    await expect(toasts(second).getByText(`Repository ${name} removed.`)).toBeVisible();
    await expect(second.getByRole('link', { name, exact: true })).toHaveCount(0);
  }

  test('exit criterion 11, on desktop with the keyboard alone', async ({ page, browser, instance, isMobile }) => {
    test.skip(isMobile, 'phones are used by touch');
    test.slow();
    const other = await browser.newContext({ baseURL: instance.url });
    try {
      await walkThrough(page, keyboard(page), instance, () => other.newPage());
    } finally {
      await other.close();
    }
  });

  test('exit criterion 11, on a phone by touch alone', async ({ page, browser, instance, isMobile }) => {
    test.skip(!isMobile, 'touch is for phones');
    test.slow();
    const other = await browser.newContext({ baseURL: instance.url });
    try {
      await walkThrough(page, touch(page), instance, () => other.newPage());
    } finally {
      await other.close();
    }
  });
});
