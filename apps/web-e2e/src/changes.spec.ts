import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { drainFailedRequests, expect, test } from './support/fixtures';
import {
  createHandbookRemote,
  type GitHttpServer,
  pushFromElsewhere,
  refusePushes,
  startGitHttpServer,
  TEST_CERTIFICATE_FILE
} from './support/git-http-server';
import {
  type GitSshServer,
  PROTECTED_KEY_PASSPHRASE,
  PROTECTED_KEY_PUBLIC,
  startGitSshServer
} from './support/git-ssh-server';
import { adminAuthToken, confirmCommitAuthor, logIn, seed, TEST_ADMIN } from './support/instance';
import { addOverApi as addRepository, ADMIN_ID, sshRepository, sshRepositoryWithSameKey } from './support/repositories';
import { gitIn } from './support/working-copy';

test.use({ instanceOptions: { onboarded: true } });

const changesButton = (page: Page, name: string | RegExp = /^Changes/) =>
  page.getByRole('toolbar', { name: 'Tool windows' }).getByRole('button', { name });
const changesPane = (page: Page) => page.getByRole('region', { name: 'Changes', exact: true });
const rows = (page: Page) => changesPane(page).getByRole('listitem');
const tick = (page: Page, path: string) =>
  changesPane(page).getByRole('checkbox', { name: `Commit ${path}`, exact: true });
const message = (page: Page) => changesPane(page).getByRole('textbox', { name: 'Commit message' });
const commitButton = (page: Page, name: string) => changesPane(page).getByRole('button', { name, exact: true });

/** A repository of the handbook fixture, with the admin's commit author confirmed; returns its working copy. */
async function handbook(instance: { url: string; dataDir: string; }): Promise<{ id: number; dir: string; }> {
  await confirmCommitAuthor(instance.url);
  return unconfirmedHandbook(instance);
}

/** As `handbook`, for an admin who has not confirmed their commit author yet. */
function unconfirmedHandbook(instance: { dataDir: string; }, name = 'handbook'): { id: number; dir: string; } {
  const [ id ] = seed(instance.dataDir, {
    repositories: [ { userId: ADMIN_ID, name, workingCopy: 'handbook' } ]
  }).repositoryIds;
  return { id, dir: join(instance.dataDir, 'repos', String(ADMIN_ID), String(id)) };
}

/** **Fetch**, **Pull**, **Push** or **Abort merge**: in the bar, or in the git actions menu on a phone (GA-7, GC-6). */
async function gitAction(page: Page, name: 'Fetch' | 'Pull' | 'Push' | 'Abort merge'): Promise<void> {
  // Not the banner landmark: the notices below the bar have a Pull of their own.
  const bar = page.locator('rs-repository-bar');
  const button = bar.getByRole('button', { name, exact: true });
  const gitActions = bar.getByRole('button', { name: 'Git actions' });
  await expect(button.or(gitActions)).toBeVisible();
  if (await gitActions.isVisible()) {
    await gitActions.click();
    await page.getByRole('menuitem', { name }).click();
  } else {
    await button.click();
  }
}

const push = (page: Page) => gitAction(page, 'Push');

const FETCH_FAILED = 'Couldn\'t check for remote changes';
const KEY_LOCKED = 'Unlock laptop to check for remote changes.';
const fetchStatus = (page: Page) => page.getByRole('banner').locator('rs-fetch-status');

/** The git actions menu's button while it says that there is a warning, on a phone (GA-35, NV-11). */
const warnedActions = (page: Page, headline: string) =>
  page.getByRole('banner').getByRole('button', { name: `Git actions. ${headline}` });

/** The quiet fetch status's text and actions: in the bar, or in a panel the git actions menu opens on a phone (GA-35, NV-11). */
async function fetchStatusDetails(page: Page, headline = FETCH_FAILED): Promise<Locator> {
  const trigger = warnedActions(page, headline);
  const text = fetchStatus(page).getByText(headline);
  await expect(trigger.or(text)).toBeVisible();
  if (!await trigger.isVisible()) {
    return fetchStatus(page);
  }
  const details = page.getByRole('dialog', { name: headline });
  if (!await details.isVisible()) {
    await trigger.click();
    await page.getByRole('menuitem', { name: headline }).click();
  }
  await expect(details).toBeVisible();
  return details;
}

/** The status is there but says nothing, on any screen. */
const expectNoFetchProblem = (page: Page) => expect(fetchStatus(page)).toHaveText('');

async function openScreen(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await logIn(page);
}

/** Shows **Changes**: beside the editor on wide screens, and a drawer on phones (GA-10). */
async function showChanges(page: Page): Promise<void> {
  if (await changesButton(page).getAttribute('aria-pressed') === 'false') {
    await changesButton(page).click();
  }
  await expect(changesPane(page)).toBeVisible();
}

test.describe('the branch list', () => {
  const branchButton = (page: Page, name: string) =>
    page.getByRole('banner').getByRole('button', { name: `Branch ${name}: open the branch list` });
  const list = (page: Page) => page.getByRole('dialog', { name: 'Branches' });
  const filter = (page: Page) => list(page).getByRole('textbox', { name: 'Filter branches' });

  test('AC-GIT-002.18: in a single-branch clone, the branch list shows the single-branch note', async ({ page, instance }) => {
    const [ id ] = seed(instance.dataDir, {
      repositories: [ { userId: ADMIN_ID, name: 'single', workingCopy: 'handbook', cloneMode: 'single-branch' } ]
    }).repositoryIds;
    await openScreen(page, `/repositories/${id}`);

    await branchButton(page, 'main').click();

    await expect(
      list(page).getByText(
        'This is a single-branch clone, so other remote branches aren\'t available.',
        { exact: true }
      )
    ).toBeVisible();
    expect((await new AxeBuilder({ page }).include('rs-branch-list').analyze()).violations).toEqual([]);
  });

  test('lists and filters the branches, with the current one marked, and returns the focus', async ({ page, instance }) => {
    const { id, dir } = unconfirmedHandbook(instance);
    gitIn(dir, 'branch', 'Docs');
    gitIn(dir, 'update-ref', 'refs/remotes/origin/feature', 'HEAD');
    await openScreen(page, `/repositories/${id}`);

    await branchButton(page, 'main').click();

    await expect(filter(page)).toBeFocused();
    const rows = list(page).getByRole('listitem');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toHaveText('Docs');
    await expect(rows.nth(1)).toHaveText(/main\s*Current branch/);
    await expect(rows.nth(2)).toHaveText('origin/feature');
    await expect(list(page).getByRole('button', { name: /^main/ })).toHaveAttribute('aria-current', 'true');
    expect((await new AxeBuilder({ page }).include('rs-branch-list').analyze()).violations).toEqual([]);

    await filter(page).fill('docs');
    await expect(rows).toHaveCount(1);
    await filter(page).fill('nothing like this');
    await expect(rows).toHaveCount(0);
    await expect(list(page).getByRole('status')).toHaveText('No branches match this filter.');

    await page.keyboard.press('Escape');
    await expect(list(page)).toHaveCount(0);
    await expect(branchButton(page, 'main')).toBeFocused();
  });

  test('works with the keyboard alone', async ({ page, instance, isMobile }) => {
    test.skip(isMobile, 'A phone has no keyboard.');
    const { id, dir } = unconfirmedHandbook(instance);
    gitIn(dir, 'branch', 'Docs');
    await openScreen(page, `/repositories/${id}`);
    await expect(branchButton(page, 'main')).toBeVisible();

    await branchButton(page, 'main').focus();
    await page.keyboard.press('Enter');
    await expect(filter(page)).toBeFocused();
    // The filter has the focus at once, and the rows come with the list's read.
    await expect(list(page).getByRole('button', { name: 'Docs' })).toBeVisible();

    await page.keyboard.press('Tab');
    await expect(list(page).getByRole('button', { name: 'Docs' })).toBeFocused();
    await page.keyboard.press('Enter');

    // Selecting a branch only closes the list until plan 87.
    await expect(list(page)).toHaveCount(0);
    await expect(branchButton(page, 'main')).toBeFocused();
  });

  test('keeps a row reached with Shift+Tab clear of the filter', async ({ page, instance, isMobile }) => {
    test.skip(isMobile, 'A phone has no keyboard.');
    await page.setViewportSize({ width: 800, height: 400 });
    const { id, dir } = unconfirmedHandbook(instance);
    for (let index = 0; index < 30; index++) {
      gitIn(dir, 'branch', `branch-${String(index).padStart(2, '0')}`);
    }
    await openScreen(page, `/repositories/${id}`);
    await branchButton(page, 'main').click();
    await expect(list(page).getByRole('button', { name: 'branch-29' })).toBeVisible();

    // The last branch scrolls the list to its end; each row above it then comes from under the filter.
    await list(page).getByRole('button', { name: 'branch-29' }).focus();
    for (let index = 28; index >= 0; index--) {
      await page.keyboard.press('Shift+Tab');
      const focused = list(page).getByRole('button', { name: `branch-${String(index).padStart(2, '0')}` });
      await expect(focused).toBeFocused();
      const row = await focused.boundingBox();
      const field = await list(page).locator('.filter').boundingBox();
      expect(row?.y).toBeGreaterThanOrEqual((field?.y ?? Infinity) + (field?.height ?? Infinity) - 1);
    }
  });

  test('shows a long name without scrolling sideways', async ({ page, instance }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    const { id, dir } = unconfirmedHandbook(instance);
    const branch = `notes/${'a-long-branch-name-'.repeat(11)}`.slice(0, 200);
    gitIn(dir, 'checkout', '-q', '-b', branch);
    await openScreen(page, `/repositories/${id}`);

    await branchButton(page, branch).click();

    const row = list(page).getByRole('listitem').filter({ hasText: branch });
    await expect(row).toBeVisible();
    expect(await list(page).locator('.body').evaluate(body => body.scrollWidth <= body.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const box = await row.boundingBox();
    expect((box?.x ?? Infinity) + (box?.width ?? Infinity)).toBeLessThanOrEqual(320);
  });

  test('says why the list cannot be read, and Try again reads it', async ({ page, instance, monitor }) => {
    const { id } = unconfirmedHandbook(instance);
    await openScreen(page, `/repositories/${id}`);
    await expect(branchButton(page, 'main')).toBeVisible();
    await page.route('**/git/branches', route =>
      route.fulfill({
        status: 500,
        json: { code: 'internal', params: {}, requestId: 'abcdef0123456789', message: 'internal' }
      }), { times: 1 });

    await branchButton(page, 'main').click();

    await expect(list(page).getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(list(page).getByRole('listitem')).toHaveCount(0);

    await list(page).getByRole('button', { name: 'Try again' }).click();

    await expect(list(page).getByRole('listitem')).toHaveCount(1);
    await expect(filter(page)).toBeFocused();
    drainFailedRequests(monitor, `/api/v1/repositories/${id}/git/branches`);
  });
});

test.describe('committing', () => {
  test('AC-GIT-002.4: unticking one of three files commits the two ticked files as the commit author, and the third stays in Changes', async ({ page, instance }) => {
    const { id, dir } = await handbook(instance);
    writeFileSync(join(dir, 'README.md'), '# Changed\n');
    writeFileSync(join(dir, 'docs/guide.md'), '# Changed\n');
    writeFileSync(join(dir, 'new.md'), '# New\n');
    await openScreen(page, `/repositories/${id}`);
    await expect(changesButton(page, 'Changes (3)')).toBeVisible();
    await showChanges(page);

    await expect(commitButton(page, 'Commit 3 files')).toHaveAttribute('aria-disabled', 'true');
    // `force`: Playwright waits for a button that is `aria-disabled` to be enabled, but a tap here says why.
    await commitButton(page, 'Commit 3 files').click({ force: true });
    await expect(page.locator('ui-tooltip')).toHaveText('Write a commit message first.');

    await tick(page, 'new.md').click();
    await expect(commitButton(page, 'Commit 2 files')).toBeVisible();
    await expect(changesPane(page).getByRole('checkbox', { name: 'All files' })).toHaveAttribute(
      'aria-checked',
      'mixed'
    );
    await message(page).fill('Change two files');
    expect((await new AxeBuilder({ page }).include('rs-changes-pane').analyze()).violations).toEqual([]);

    await commitButton(page, 'Commit 2 files').click();

    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page)).toContainText('new.md');
    await expect(changesButton(page, 'Changes (1)')).toBeVisible();
    await expect(message(page)).toHaveValue('');
    expect(gitIn(dir, 'show', '--name-only', '--format=', 'HEAD').trim().split('\n')).toEqual([
      'README.md',
      'docs/guide.md'
    ]);
    const author = `${TEST_ADMIN.displayName} <${TEST_ADMIN.email}>`;
    expect(gitIn(dir, 'log', '-1', '--format=%an <%ae>|%cn <%ce>').trim()).toBe(`${author}|${author}`);
    expect(gitIn(dir, 'status', '--porcelain').trim()).toBe('?? new.md');
  });

  test('AC-GIT-002.5: typing and committing at once includes the last edit', async ({ page, instance }) => {
    const { id, dir } = await handbook(instance);
    // A clean file, so that **Changes** does not list it until a status has been read after the save.
    await openScreen(page, `/repositories/${id}/files/README.md`);

    await page.getByRole('main', { name: 'Editor' }).getByRole('textbox', { name: 'README.md', exact: true }).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('The last edit');
    await showChanges(page);
    await message(page).fill('With the last edit');
    await commitButton(page, 'Commit 1 file').click();

    // The field is cleared by the commit. "No changes" may still be there from before the first edit.
    await expect(message(page)).toHaveValue('');
    expect(gitIn(dir, 'show', 'HEAD:README.md')).toContain('The last edit');
    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toContain('The last edit');
    await expect(changesPane(page).getByText('No changes since the last commit.')).toBeVisible();
    expect(gitIn(dir, 'status', '--porcelain').trim()).toBe('');
  });

  test('AC-GIT-002.6: a first line over 72 characters shows a hint and still commits, and a line starting with # is kept', async ({ page, instance }) => {
    const { id, dir } = await handbook(instance);
    writeFileSync(join(dir, 'README.md'), '# Changed\n');
    await openScreen(page, `/repositories/${id}`);
    await expect(changesButton(page, 'Changes (1)')).toBeVisible();
    await showChanges(page);
    const hint = changesPane(page).getByText('The first line is longer than 72 characters.');
    const subject = 'x'.repeat(73);

    await message(page).fill('x'.repeat(72));
    await expect(hint).toBeHidden();
    await message(page).fill(`${subject}\n\n# Kept\n  \n\n`);
    await expect(hint).toBeVisible();
    await commitButton(page, 'Commit 1 file').click();

    await expect(changesPane(page).getByText('No changes since the last commit.')).toBeVisible();
    expect(gitIn(dir, 'log', '-1', '--format=%B').trimEnd()).toBe(`${subject}\n\n# Kept`);
  });

  test('AC-GIT-002.23: an unticked file stays unticked after a reload, and a file changed later appears ticked', async ({ page, instance }) => {
    const { id, dir } = await handbook(instance);
    writeFileSync(join(dir, 'README.md'), '# Changed\n');
    writeFileSync(join(dir, 'new.md'), '# New\n');
    await openScreen(page, `/repositories/${id}`);
    await expect(changesButton(page, 'Changes (2)')).toBeVisible();
    await showChanges(page);
    await tick(page, 'new.md').click();
    await expect(tick(page, 'new.md')).not.toBeChecked();

    writeFileSync(join(dir, 'later.md'), '# Later\n');
    await page.reload();
    await expect(changesButton(page, 'Changes (3)')).toBeVisible();
    await showChanges(page);

    await expect(tick(page, 'new.md')).not.toBeChecked();
    await expect(tick(page, 'README.md')).toBeChecked();
    await expect(tick(page, 'later.md')).toBeChecked();
  });
});

test.describe('amending', () => {
  const amend = (page: Page) => changesPane(page).getByRole('checkbox', { name: 'Amend last commit', exact: true });

  test('AC-GIT-002.7: Amend is offered after a local commit and not after it is pushed; amending with no ticked files changes only the message', async ({ page, instance }) => {
    const { id, dir } = await handbook(instance);
    writeFileSync(join(dir, 'README.md'), '# Changed\n');
    writeFileSync(join(dir, 'new.md'), '# New\n');
    await openScreen(page, `/repositories/${id}`);
    await expect(changesButton(page, 'Changes (2)')).toBeVisible();
    await showChanges(page);

    await tick(page, 'new.md').click();
    await message(page).fill('First message');
    await commitButton(page, 'Commit 1 file').click();
    await expect(changesButton(page, 'Changes (1)')).toBeVisible();
    const parent = gitIn(dir, 'rev-parse', 'HEAD~1').trim();

    await amend(page).check();
    await expect(message(page)).toHaveValue('First message');
    await message(page).fill('Better message');
    await commitButton(page, 'Amend').click();

    await expect(message(page)).toHaveValue('');
    await expect(amend(page)).not.toBeChecked();
    expect(gitIn(dir, 'log', '-1', '--format=%s').trim()).toBe('Better message');
    expect(gitIn(dir, 'rev-parse', 'HEAD~1').trim()).toBe(parent);
    expect(gitIn(dir, 'show', '--name-only', '--format=', 'HEAD').trim()).toBe('README.md');
    expect(gitIn(dir, 'status', '--porcelain').trim()).toBe('?? new.md');

    // The remote ref a push would leave behind.
    gitIn(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    await page.reload();
    await showChanges(page);
    await expect(commitButton(page, 'Commit 0 files')).toBeVisible();
    await expect(amend(page)).toHaveCount(0);
  });
});

test.describe('pushing', () => {
  test.use({ instanceOptions: { onboarded: true, gitCaFile: TEST_CERTIFICATE_FILE } });

  let root: string;
  let git: GitHttpServer;
  /** The server's repositories, which each test adds to. */
  const remotes: Record<string, string> = {};
  let next = 0;

  test.beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'front-burner-web-e2e-push-'));
    git = await startGitHttpServer({ repositories: remotes });
  });

  test.afterAll(async () => {
    await git?.close();
    rmSync(root, { recursive: true, force: true });
  });

  const bar = (page: Page) => page.getByRole('banner');
  const gitActions = (page: Page) => bar(page).getByRole('button', { name: 'Git actions' });

  const summary = (page: Page) => bar(page).locator('rs-git-status-summary');
  const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications' });

  /**
   * A repository whose remote is a bare repository on the git server: an empty
   * one, so that `main` is unpublished, or the handbook remote, cloned.
   */
  function pushable(
    instance: { dataDir: string; },
    remote: 'empty' | 'cloned'
  ): { id: number; dir: string; bare: string; } {
    const name = `remote-${next++}.git`;
    const parent = join(root, name.replace('.git', ''));
    mkdirSync(parent, { recursive: true });
    const bare = remote === 'cloned' ? createHandbookRemote(parent) : join(parent, 'handbook.git');
    if (remote === 'empty') {
      gitIn(parent, 'init', '-q', '--bare', '-b', 'main', bare);
    }
    remotes[name] = bare;
    const remoteUrl = `${git.url}/${name}`;
    const [ id ] = seed(instance.dataDir, {
      repositories: [ { userId: ADMIN_ID, name: `pushed-${next}`, remoteUrl } ]
    }).repositoryIds;
    const dir = join(instance.dataDir, 'repos', String(ADMIN_ID), String(id));
    if (remote === 'cloned') {
      rmSync(dir, { recursive: true, force: true });
      gitIn(dirname(dir), 'clone', '-q', bare, dir);
      gitIn(dir, 'remote', 'set-url', 'origin', remoteUrl);
    } else {
      gitIn(dir, 'remote', 'add', 'origin', remoteUrl);
    }
    return { id, dir, bare };
  }

  test('AC-GIT-002.10: Push publishes an unpublished branch, and the bar then shows no counts', async ({ page, instance }) => {
    const { id, dir, bare } = pushable(instance, 'empty');
    await openScreen(page, `/repositories/${id}`);
    await expect(summary(page)).toHaveText(/main\s*·\s*Not published/);

    await push(page);

    await expect(toasts(page).getByText('Pushed 1 commit to origin/main')).toBeVisible();
    await expect(summary(page)).toHaveText('main');
    expect(gitIn(dir, 'rev-parse', '--abbrev-ref', 'main@{upstream}').trim()).toBe('origin/main');
    expect(gitIn(bare, 'rev-parse', 'main').trim()).toBe(gitIn(dir, 'rev-parse', 'HEAD').trim());
  });

  test('says Pushed 2 commits to origin/main, and the counts update', async ({ page, instance }) => {
    const { id, dir, bare } = pushable(instance, 'cloned');
    gitIn(dir, 'commit', '-q', '--allow-empty', '-m', 'second');
    gitIn(dir, 'commit', '-q', '--allow-empty', '-m', 'third');
    await openScreen(page, `/repositories/${id}`);
    await expect(summary(page)).toHaveText(/main\s*·\s*2 to push/);

    await push(page);

    await expect(toasts(page).getByText('Pushed 2 commits to origin/main')).toBeVisible();
    await expect(summary(page)).toHaveText('main');
    expect(gitIn(bare, 'log', '-1', '--format=%s', 'main').trim()).toBe('third');
  });

  test('Fetch brings the counts of a commit pushed elsewhere', async ({ page, instance }) => {
    const { id, bare } = pushable(instance, 'cloned');
    await openScreen(page, `/repositories/${id}`);
    await expect(summary(page)).toHaveText('main');

    // Someone else pushes a commit to the remote.
    const elsewhere = join(dirname(bare), 'elsewhere');
    gitIn(dirname(bare), 'clone', '-q', bare, elsewhere);
    gitIn(elsewhere, 'commit', '-q', '--allow-empty', '-m', 'from elsewhere');
    gitIn(elsewhere, 'push', '-q', 'origin', 'main');

    await gitAction(page, 'Fetch');

    await expect(summary(page)).toHaveText(/main\s*·\s*1 to pull/);
  });

  test('AC-GIT-002.12: shows a hook\'s lines as text', async ({ page, instance }) => {
    const { id, dir, bare } = pushable(instance, 'cloned');
    const before = gitIn(bare, 'rev-parse', 'main').trim();
    refusePushes(bare, [ '<b>Pushes to main need a review</b>', 'Open a pull request instead.' ]);
    gitIn(dir, 'commit', '-q', '--allow-empty', '-m', 'second');
    await openScreen(page, `/repositories/${id}`);

    await push(page);

    const problem = bar(page).locator('rs-git-problem');
    await expect(problem).toContainText('The remote refused the push.');
    const lines = problem.locator('pre');
    await expect(lines).toContainText('<b>Pushes to main need a review</b>');
    await expect(lines).toContainText('Open a pull request instead.');
    await expect(lines.locator('b')).toHaveCount(0);
    // Nothing was forced, and the commit is still to push.
    expect(gitIn(bare, 'rev-parse', 'main').trim()).toBe(before);
    await expect(summary(page)).toHaveText(/1 to push/);
    expect((await new AxeBuilder({ page }).include('rs-git-problem').analyze()).violations).toEqual([]);

    await problem.getByRole('button', { name: 'Dismiss' }).click();
    await expect(problem).toHaveCount(0);
  });

  test.describe('the quiet fetch status', () => {
    test('a background fetch that failed says so in the bar, and Try again that succeeds removes it', async ({ page, instance }) => {
      const { id, bare } = pushable(instance, 'cloned');
      const away = `${bare}.away`;
      renameSync(bare, away);
      await openScreen(page, `/repositories/${id}`);

      await expect(fetchStatus(page).getByRole('button').first().or(warnedActions(page, FETCH_FAILED))).toBeVisible();
      // Nothing opened by itself.
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(bar(page).locator('rs-git-problem')).toHaveCount(0);
      expect((await new AxeBuilder({ page }).include('rs-fetch-status').analyze()).violations).toEqual([]);

      // It is state, not an event.
      await page.reload();
      await expect(await fetchStatusDetails(page)).toContainText(FETCH_FAILED);

      renameSync(away, bare);
      await (await fetchStatusDetails(page)).getByRole('button', { name: 'Try again' }).click();

      await expectNoFetchProblem(page);
      await expect(toasts(page).getByText('No new commits')).toBeVisible();
    });

    test('on a phone it is in the git actions menu, whose item shows the text, and the save status stays in the bar', async ({ page, instance }) => {
      await page.setViewportSize({ width: 375, height: 700 });
      const { id, bare } = pushable(instance, 'cloned');
      renameSync(bare, `${bare}.away`);
      await openScreen(page, `/repositories/${id}`);

      const trigger = warnedActions(page, FETCH_FAILED);
      await expect(trigger).toBeVisible();
      await expect(fetchStatus(page)).toHaveText('');

      await trigger.click();
      await page.getByRole('menuitem', { name: FETCH_FAILED }).click();
      const details = page.getByRole('dialog', { name: FETCH_FAILED });
      await expect(details).toContainText(FETCH_FAILED);
      await expect(details.getByRole('button', { name: 'Try again' })).toBeFocused();
      expect((await new AxeBuilder({ page }).include('ui-popover').analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

      await details.getByRole('button', { name: 'Try again' }).click();
      await expect(details).toHaveCount(0);
      await expect(trigger).toBeFocused();
    });
  });

  test('moves Push into a menu on a phone', async ({ page, instance }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    const { id, dir } = pushable(instance, 'cloned');
    gitIn(dir, 'commit', '-q', '--allow-empty', '-m', 'second');
    await openScreen(page, `/repositories/${id}`);
    await expect(summary(page)).toHaveText(/1 to push/);

    await gitActions(page).click();
    await page.getByRole('menuitem', { name: 'Push' }).click();

    await expect(toasts(page).getByText('Pushed 1 commit to origin/main')).toBeVisible();
    await expect(summary(page)).toHaveText('main');
  });

  test.describe('pulling', () => {
    const NOT_CLEAN = 'Commit or discard your changes before pulling.';
    const PULL_FIRST = 'The remote has new commits. Pull first.';
    const problem = (page: Page) => page.getByRole('banner').locator('rs-git-problem');
    const commitsOf = (repository: string, ref = 'HEAD') =>
      gitIn(repository, 'rev-list', '--count', ref).toString().trim();

    /**
     * Commits `guide.md` and pushes it: to the bare repository itself, as a
     * blocking git call here would wait for the server that this process runs.
     */
    function publishGuide(dir: string, bare: string): void {
      writeFileSync(join(dir, 'guide.md'), 'before\n');
      gitIn(dir, 'add', 'guide.md');
      gitIn(dir, 'commit', '-q', '-m', 'guide');
      gitIn(dir, 'push', '-q', bare, 'main');
      gitIn(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    }

    test('AC-GIT-002.1: the header shows the current branch, 2 to push, 3 to pull after a fetch, and Fetch, Pull and Push; on a phone the counts stay visible and the buttons are in a menu', async ({ page, instance }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      const { id, dir, bare } = pushable(instance, 'cloned');
      gitIn(dir, 'commit', '-q', '--allow-empty', '-m', 'mine 1');
      gitIn(dir, 'commit', '-q', '--allow-empty', '-m', 'mine 2');
      pushFromElsewhere(bare, 'main', [ {}, {}, {} ]);
      await openScreen(page, `/repositories/${id}`);

      await gitAction(page, 'Fetch');

      await expect(summary(page)).toHaveText(/main\s*·\s*2 to push, 3 to pull/);
      const actions = page.locator('rs-git-actions');
      for (const name of [ 'Fetch', 'Pull', 'Push' ]) {
        await expect(actions.getByRole('button', { name, exact: true })).toBeVisible();
      }

      await page.setViewportSize({ width: 375, height: 700 });

      await expect(summary(page)).toHaveText(/main\s*·\s*2 to push, 3 to pull/);
      await expect(actions.getByRole('button', { name: 'Pull', exact: true })).toHaveCount(0);
      await gitActions(page).click();
      for (const name of [ 'Fetch', 'Pull', 'Push' ]) {
        await expect(page.getByRole('menuitem', { name })).toBeVisible();
      }
    });

    test('AC-GIT-002.9: Pull with uncommitted changes says Commit or discard your changes before pulling. With a clean working copy, it fast-forwards or makes a merge commit, and says how many commits it pulled', async ({ page, instance, monitor }) => {
      await confirmCommitAuthor(instance.url);
      const { id, dir, bare } = pushable(instance, 'cloned');
      pushFromElsewhere(bare, 'main', [ { 'theirs.md': 'theirs\n' }, {}, {} ]);
      writeFileSync(join(dir, 'mine.md'), 'mine\n');
      await openScreen(page, `/repositories/${id}`);

      await gitAction(page, 'Pull');

      await expect(problem(page)).toContainText(NOT_CLEAN);
      expect(existsSync(join(dir, 'theirs.md'))).toBe(false);
      expect(existsSync(join(dir, 'mine.md'))).toBe(true);
      await problem(page).getByRole('button', { name: 'Show changes' }).click();
      await expect(changesPane(page)).toBeVisible();
      await expect(rows(page).filter({ hasText: 'mine.md' })).toBeVisible();

      // Clean: a fast-forward.
      rmSync(join(dir, 'mine.md'));
      await page.reload();
      await gitAction(page, 'Pull');

      await expect(toasts(page).getByText('Pulled 3 commits')).toBeVisible();
      expect(readFileSync(join(dir, 'theirs.md'), 'utf8')).toBe('theirs\n');
      expect(gitIn(dir, 'rev-list', '--merges', '--count', 'HEAD').toString().trim()).toBe('0');

      // Commits on both sides: a merge commit.
      gitIn(dir, 'commit', '-q', '--allow-empty', '-m', 'mine');
      pushFromElsewhere(bare, 'main', [ {} ]);
      await gitAction(page, 'Pull');

      await expect(toasts(page).getByText('Pulled 1 commit', { exact: true })).toBeVisible();
      expect(gitIn(dir, 'rev-list', '--merges', '--count', 'HEAD').toString().trim()).toBe('1');
      await expect(summary(page)).toHaveText(/main\s*·\s*2 to push/);

      // Nothing more.
      await gitAction(page, 'Pull');
      await expect(toasts(page).getByText('Already up to date')).toBeVisible();
      drainFailedRequests(monitor, `/api/v1/repositories/${id}/git/pull`);
    });

    test('AC-GIT-002.11: a push rejected because the remote has new commits says The remote has new commits. Pull first. and offers Pull; no push is forced', async ({ page, instance, monitor }) => {
      await confirmCommitAuthor(instance.url);
      const { id, dir, bare } = pushable(instance, 'cloned');
      gitIn(dir, 'commit', '-q', '--allow-empty', '-m', 'mine');
      pushFromElsewhere(bare, 'main', [ {} ]);
      const before = commitsOf(bare, 'main');
      await openScreen(page, `/repositories/${id}`);

      await push(page);

      await expect(problem(page)).toContainText(PULL_FIRST);
      await expect(problem(page).getByRole('button', { name: /force/i })).toHaveCount(0);
      expect(commitsOf(bare, 'main')).toBe(before);

      // Still leads somewhere with uncommitted changes (GA-26).
      writeFileSync(join(dir, 'mine.md'), 'mine\n');
      await problem(page).getByRole('button', { name: 'Pull', exact: true }).click();
      await expect(problem(page)).toContainText(NOT_CLEAN);
      rmSync(join(dir, 'mine.md'));

      await gitAction(page, 'Pull');

      await expect(toasts(page).getByText('Pulled 1 commit', { exact: true })).toBeVisible();
      await expect(problem(page)).toHaveCount(0);
      await push(page);
      await expect(toasts(page).getByText('Pushed 2 commits to origin/main')).toBeVisible();
      drainFailedRequests(monitor, `/api/v1/repositories/${id}/git/pull`);
    });

    test('AC-REPO-002.2: fetching and pulling a public repository work without credentials', async ({ page, instance }) => {
      const { id, dir, bare } = pushable(instance, 'cloned');
      pushFromElsewhere(bare, 'main', [ { 'theirs.md': 'theirs\n' } ]);
      await openScreen(page, `/repositories/${id}`);

      await gitAction(page, 'Fetch');
      await expect(summary(page)).toHaveText(/main\s*·\s*1 to pull/);
      await gitAction(page, 'Pull');

      await expect(toasts(page).getByText('Pulled 1 commit', { exact: true })).toBeVisible();
      await expect(summary(page)).toHaveText('main');
      expect(existsSync(join(dir, 'theirs.md'))).toBe(true);
    });

    test('a merge commit asks for the commit author; cancelling cancels the pull, and the fetched counts show', async ({ page, instance }) => {
      const { id, dir, bare } = pushable(instance, 'cloned');
      gitIn(dir, 'commit', '-q', '--allow-empty', '-m', 'mine');
      pushFromElsewhere(bare, 'main', [ {} ]);
      await openScreen(page, `/repositories/${id}`);

      await gitAction(page, 'Pull');

      const question = page.getByRole('dialog', { name: 'Confirm your commit author' });
      await question.getByRole('button', { name: 'Cancel' }).click();
      await expect(summary(page)).toHaveText(/main\s*·\s*1 to push, 1 to pull/);
      await expect(problem(page)).toHaveCount(0);
      expect(gitIn(dir, 'rev-list', '--merges', '--count', 'HEAD').toString().trim()).toBe('0');

      await gitAction(page, 'Pull');
      await question.getByRole('button', { name: /^Commit as / }).click();

      await expect(toasts(page).getByText('Pulled 1 commit', { exact: true })).toBeVisible();
      expect(gitIn(dir, 'rev-list', '--merges', '--count', 'HEAD').toString().trim()).toBe('1');
    });

    test('a fast-forward does not ask for the commit author', async ({ page, instance }) => {
      const { id, bare } = pushable(instance, 'cloned');
      pushFromElsewhere(bare, 'main', [ {} ]);
      await openScreen(page, `/repositories/${id}`);

      await gitAction(page, 'Pull');

      await expect(toasts(page).getByText('Pulled 1 commit', { exact: true })).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    });

    test('a pull that conflicts shows the merge bar on both tabs, and Abort merge goes back', async ({ page, context, instance, monitor }) => {
      await confirmCommitAuthor(instance.url);
      const { id, dir, bare } = pushable(instance, 'cloned');
      writeFileSync(join(dir, 'guide.md'), 'mine\n');
      gitIn(dir, 'add', 'guide.md');
      gitIn(dir, 'commit', '-q', '-m', 'mine');
      pushFromElsewhere(bare, 'main', [ { 'guide.md': 'theirs\n' } ]);
      await openScreen(page, `/repositories/${id}`);
      const other = await context.newPage();
      await other.goto(`/repositories/${id}`);
      await expect(summary(other)).toHaveText(/main\s*·\s*1 to push/);

      await gitAction(page, 'Pull');

      for (const tab of [ page, other ]) {
        await expect(bar(tab).getByText('0 of 1 file resolved', { exact: true })).toBeVisible();
      }
      await expect(toasts(page).getByText(/Pulled/)).toHaveCount(0);
      await expect(problem(page)).toHaveCount(0);

      await gitAction(page, 'Abort merge');
      await page.getByRole('dialog', { name: 'Abort the merge?' }).getByRole('button', { name: 'Abort merge' }).click();

      for (const tab of [ page, other ]) {
        await expect(summary(tab)).toHaveText(/main\s*·\s*1 to push, 1 to pull/);
      }
      expect(readFileSync(join(dir, 'guide.md'), 'utf8')).toBe('mine\n');
      await other.close();
      // The abort's own event can read a merge that has just ended, which the store takes as its end.
      drainFailedRequests(monitor, `/api/v1/repositories/${id}/git/merge`);
    });

    test('a branch named like a remote one pulls, then pushes', async ({ page, instance }) => {
      await confirmCommitAuthor(instance.url);
      const { id, dir, bare } = pushable(instance, 'cloned');
      pushFromElsewhere(bare, 'notes', [ {} ]);
      gitIn(dir, 'checkout', '-q', '-b', 'notes');
      gitIn(dir, 'commit', '-q', '--allow-empty', '-m', 'mine');
      await openScreen(page, `/repositories/${id}`);

      await push(page);

      await expect(problem(page)).toContainText(PULL_FIRST);
      await problem(page).getByRole('button', { name: 'Pull', exact: true }).click();

      await expect(toasts(page).getByText('Pulled 1 commit', { exact: true })).toBeVisible();
      await expect(summary(page)).toHaveText(/notes\s*·\s*2 to push/);
      expect(gitIn(dir, 'rev-parse', '--abbrev-ref', '@{upstream}').toString().trim()).toBe('origin/notes');

      await push(page);

      await expect(toasts(page).getByText('Pushed 2 commits to origin/notes')).toBeVisible();
    });

    test('Commit or discard goes away once the changes are committed', async ({ page, instance, monitor }) => {
      await confirmCommitAuthor(instance.url);
      const { id, dir } = pushable(instance, 'cloned');
      writeFileSync(join(dir, 'mine.md'), 'mine\n');
      await openScreen(page, `/repositories/${id}`);

      await gitAction(page, 'Pull');
      await expect(problem(page)).toContainText(NOT_CLEAN);
      await problem(page).getByRole('button', { name: 'Show changes' }).click();
      await message(page).fill('mine');
      await commitButton(page, 'Commit 1 file').click();

      await expect(problem(page)).toHaveCount(0);
      drainFailedRequests(monitor, `/api/v1/repositories/${id}/git/pull`);
    });

    test.describe('the remote-change notice', () => {
      const notice = (page: Page) => page.locator('rs-remote-change-notice');
      const FILE_CHANGED = 'This file changed too.';

      test('AC-GIT-002.13: while the repository is viewed, a commit pushed to the upstream from elsewhere shows 1 new commit on origin/main within about 2 minutes, with This file changed too. when it changes the open file; the user\'s files do not change until they pull', async ({ page, instance, browserName, isMobile }) => {
        test.skip(
          browserName !== 'chromium' || isMobile,
          'It waits for a whole fetch interval, and what it proves does not depend on the browser.'
        );
        // The interval is a constant (A-6.7).
        test.setTimeout(150_000);
        const { id, dir, bare } = pushable(instance, 'cloned');
        publishGuide(dir, bare);
        await openScreen(page, `/repositories/${id}/files/guide.md`);
        await expect(page.locator('.cm-content')).toContainText('before');
        // Past the fetches of opening the file and of starting to view it, which the scheduler
        // queues within 5 seconds, so that only the next one, 2 minutes later, can find the commit.
        await page.waitForTimeout(7_000);

        pushFromElsewhere(bare, 'main', [ { 'guide.md': 'from elsewhere\n' } ]);

        await expect(notice(page)).toContainText('1 new commit on origin/main', { timeout: 130_000 });
        await expect(notice(page)).toContainText(FILE_CHANGED);
        await expect(page.locator('.cm-content')).toContainText('before');
        expect(readFileSync(join(dir, 'guide.md'), 'utf8')).toBe('before\n');
      });

      test('a commit to another file does not name the open file; dismissed, it comes back with more commits, and its Pull pulls', async ({ page, instance }) => {
        const { id, dir, bare } = pushable(instance, 'cloned');
        publishGuide(dir, bare);
        pushFromElsewhere(bare, 'main', [ { 'elsewhere.md': 'other\n' } ]);
        await openScreen(page, `/repositories/${id}/files/guide.md`);

        await gitAction(page, 'Fetch');

        await expect(notice(page)).toContainText('1 new commit on origin/main');
        await expect(notice(page)).not.toContainText(FILE_CHANGED);

        await notice(page).getByRole('button', { name: 'Dismiss' }).click();
        await expect(notice(page)).toHaveCount(0);

        pushFromElsewhere(bare, 'main', [ { 'guide.md': 'from elsewhere\n' } ]);
        await gitAction(page, 'Fetch');

        await expect(notice(page)).toContainText('2 new commits on origin/main');
        await expect(notice(page)).toContainText(FILE_CHANGED);

        await notice(page).getByRole('button', { name: 'Pull', exact: true }).click();

        await expect(toasts(page).getByText('Pulled 2 commits', { exact: true })).toBeVisible();
        await expect(notice(page)).toHaveCount(0);
        await expect(page.locator('.cm-content')).toContainText('from elsewhere');
      });
    });

    test('reloads the open file after a pull', async ({ page, instance }) => {
      await confirmCommitAuthor(instance.url);
      const { id, dir, bare } = pushable(instance, 'cloned');
      publishGuide(dir, bare);
      pushFromElsewhere(bare, 'main', [ { 'guide.md': 'after the pull\n' } ]);
      await openScreen(page, `/repositories/${id}/files/guide.md`);
      await expect(page.locator('.cm-content')).toContainText('before');

      await gitAction(page, 'Pull');

      await expect(toasts(page).getByText('Pulled 1 commit', { exact: true })).toBeVisible();
      await expect(page.locator('.cm-content')).toContainText('after the pull');
    });

    test('a pull sends what was just typed first, which stops it rather than losing the edit', async ({ page, instance, monitor }) => {
      await confirmCommitAuthor(instance.url);
      const { id, dir, bare } = pushable(instance, 'cloned');
      publishGuide(dir, bare);
      pushFromElsewhere(bare, 'main', [ { 'guide.md': 'after the pull\n' } ]);
      await openScreen(page, `/repositories/${id}/files/guide.md`);
      await page.locator('.cm-content').click();
      await page.keyboard.type('typed ');

      await gitAction(page, 'Pull');

      await expect(problem(page)).toContainText(NOT_CLEAN);
      await expect(page.locator('.cm-content')).toContainText('typed');
      expect(readFileSync(join(dir, 'guide.md'), 'utf8')).toContain('typed');
      drainFailedRequests(monitor, `/api/v1/repositories/${id}/git/pull`);
    });
  });
});

test.describe('fixing credentials from a push', () => {
  test.use({ instanceOptions: { onboarded: true, gitCaFile: TEST_CERTIFICATE_FILE } });

  const WRITER = { username: 'writer', password: 'push-token' };
  const READER = { username: 'reader', password: 'read-token' };

  let root: string;
  let git: GitHttpServer;
  /** The server's repositories, which each test adds to; anyone may read them, as public ones. */
  const remotes: Record<string, string> = {};
  let next = 0;

  test.beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'front-burner-web-e2e-push-credentials-'));
    git = await startGitHttpServer({
      repositories: remotes,
      pushers: { [WRITER.username]: WRITER.password },
      readers: { [READER.username]: READER.password }
    });
  });

  test.afterAll(async () => {
    await git?.close();
    rmSync(root, { recursive: true, force: true });
  });

  const bar = (page: Page) => page.getByRole('banner');
  const problem = (page: Page) => bar(page).locator('rs-git-problem');
  const dialog = (page: Page) => page.getByRole('dialog', { name: 'Repository credentials' });
  const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications' });

  /** A remote on the git server, a clone of the handbook; returns its URL and the bare repository. */
  function remote(): { remoteUrl: string; bare: string; } {
    const name = `public-${next++}`;
    const parent = join(root, name);
    mkdirSync(parent, { recursive: true });
    const bare = createHandbookRemote(parent);
    remotes[`${name}.git`] = bare;
    return { remoteUrl: `${git.url}/${name}.git`, bare };
  }

  /**
   * Adds a repository of a new remote over the API, as an administrator, and
   * waits for its clone; returns its ID and the bare repository. The working
   * copy has one commit to push.
   */
  async function addOverApi(
    instance: { url: string; dataDir: string; },
    name: string,
    credentials: object
  ): Promise<{ id: number; bare: string; }> {
    const { remoteUrl, bare } = remote();
    const { id, dir } = await addRepository(instance, { name, remoteUrl, credentials });
    gitIn(dir, 'commit', '-q', '--allow-empty', '-m', 'second');
    return { id, bare };
  }

  /** Gives new HTTPS credentials in the dialog, and saves them. */
  async function saveNewCredentials(page: Page, credentials: { username: string; password: string; }): Promise<void> {
    await expect(dialog(page)).toBeVisible();
    // The radio is visually hidden, so its label is clicked.
    await dialog(page).getByRole('radiogroup').getByText('Add new credentials', { exact: true }).click();
    await expect(dialog(page).getByRole('radio', { name: 'Add new credentials' })).toBeChecked();
    await dialog(page).getByLabel('Credentials name').fill(`push-${next}`);
    await dialog(page).getByLabel('Username').fill(credentials.username);
    await dialog(page).getByLabel('Password or token', { exact: true }).fill(credentials.password);
    await dialog(page).getByRole('button', { name: 'Save' }).click();
  }

  test('AC-REPO-002.1: pushing a public repository added without credentials says so, and after adding credentials the push runs again', async ({ page, instance }) => {
    await confirmCommitAuthor(instance.url);
    const { remoteUrl, bare } = remote();
    const [ id ] = seed(instance.dataDir, {
      repositories: [ { userId: ADMIN_ID, name: `public-${next}`, remoteUrl } ]
    }).repositoryIds;
    const dir = join(instance.dataDir, 'repos', String(ADMIN_ID), String(id));
    rmSync(dir, { recursive: true, force: true });
    gitIn(dirname(dir), 'clone', '-q', bare, dir);
    gitIn(dir, 'remote', 'set-url', 'origin', remoteUrl);
    gitIn(dir, 'commit', '-q', '--allow-empty', '-m', 'second');
    await openScreen(page, `/repositories/${id}`);

    await push(page);
    await expect(problem(page)).toContainText('This repository has no credentials. Add credentials to push.');
    await problem(page).getByRole('button', { name: 'Add credentials' }).click();

    await expect(dialog(page)).toContainText('Make sure these credentials can also push.');
    await expect(dialog(page).getByRole('radio', { name: 'No credentials (public repository)' })).toBeAttached();
    await expect(dialog(page).getByRole('radio', { name: 'Paste a key' })).toHaveCount(0);
    expect((await new AxeBuilder({ page }).include('dlg-repository-credentials').analyze()).violations).toEqual([]);
    await saveNewCredentials(page, WRITER);

    await expect(dialog(page)).toHaveCount(0);
    await expect(toasts(page).getByText('Pushed 1 commit to origin/main')).toBeVisible();
    await expect(problem(page)).toHaveCount(0);
    expect(gitIn(bare, 'log', '-1', '--format=%s', 'main').trim()).toBe('second');
  });

  test('AC-REPO-002.3: pushing with a read-only token says so, and Use other credentials fixes it', async ({ page, instance }) => {
    await confirmCommitAuthor(instance.url);
    const { id, bare } = await addOverApi(instance, `read-only-${next}`, {
      mode: 'new-https',
      name: 'read only',
      ...READER
    });
    await openScreen(page, `/repositories/${id}`);

    await push(page);
    await expect(problem(page)).toContainText('Your credentials can read this repository but not push to it.');
    await problem(page).getByRole('button', { name: 'Use other credentials' }).click();

    await expect(dialog(page)).toContainText('read only');
    await saveNewCredentials(page, WRITER);

    await expect(toasts(page).getByText('Pushed 1 commit to origin/main')).toBeVisible();
    expect(gitIn(bare, 'log', '-1', '--format=%s', 'main').trim()).toBe('second');
  });

  test('AC-REPO-002.4: with an expired saved token used by four repositories, a push offers Update the token, and after updating the push runs again', async ({ page, instance }) => {
    await confirmCommitAuthor(instance.url);
    const EXPIRED = { username: WRITER.username, password: 'expired-token' };
    const { id, bare } = await addOverApi(instance, 'work-1', { mode: 'new-https', name: 'GitHub work', ...EXPIRED });
    const authToken = await adminAuthToken(instance.url);
    const info = await (await fetch(`${instance.url}/api/v1/repositories/${id}/credentials`, {
      headers: { authorization: `Bearer ${authToken}` }
    })).json() as { inUse: { id: number; }; };
    for (const name of [ 'work-2', 'work-3', 'work-4' ]) {
      await addOverApi(instance, name, { mode: 'saved', credentialId: info.inUse.id });
    }
    await openScreen(page, `/repositories/${id}`);

    await push(page);
    await expect(problem(page)).toContainText('The remote refused your credentials.');
    await problem(page).getByRole('button', { name: 'Fix credentials' }).click();

    const update = dialog(page).getByRole('radio', { name: 'Update the token of GitHub work' });
    await expect(update).toBeChecked();
    await expect(update).toBeFocused();
    await expect(dialog(page)).toContainText('Used by 4 of your repositories');
    await expect(dialog(page).getByLabel('Username')).toHaveValue(WRITER.username);
    await expect(dialog(page).getByRole('radio', { name: 'Use other credentials for this repository' }))
      .toBeAttached();
    expect((await new AxeBuilder({ page }).include('dlg-repository-credentials').analyze()).violations).toEqual([]);
    await dialog(page).getByLabel('Password or token', { exact: true }).fill(WRITER.password);
    await dialog(page).getByRole('button', { name: 'Update' }).click();

    await expect(dialog(page)).toHaveCount(0);
    await expect(toasts(page).getByText('Pushed 1 commit to origin/main')).toBeVisible();
    await expect(problem(page)).toHaveCount(0);
    expect(gitIn(bare, 'log', '-1', '--format=%s', 'main').trim()).toBe('second');
  });

  test('Cancel leaves the push alone, and the dialog scrolls on a phone', async ({ page, instance }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await confirmCommitAuthor(instance.url);
    const { remoteUrl, bare } = remote();
    const before = gitIn(bare, 'rev-parse', 'main').trim();
    const [ id ] = seed(instance.dataDir, {
      repositories: [ { userId: ADMIN_ID, name: `phone-${next}`, remoteUrl } ]
    }).repositoryIds;
    const dir = join(instance.dataDir, 'repos', String(ADMIN_ID), String(id));
    rmSync(dir, { recursive: true, force: true });
    gitIn(dirname(dir), 'clone', '-q', bare, dir);
    gitIn(dir, 'remote', 'set-url', 'origin', remoteUrl);
    gitIn(dir, 'commit', '-q', '--allow-empty', '-m', 'second');
    await openScreen(page, `/repositories/${id}`);
    await push(page);
    await problem(page).getByRole('button', { name: 'Add credentials' }).click();

    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByRole('radio', { name: 'Add new credentials' })).toBeFocused();
    const save = dialog(page).getByRole('button', { name: 'Save' });
    await expect(save).toBeInViewport();
    await dialog(page).getByLabel('Password or token', { exact: true }).scrollIntoViewIfNeeded();
    await expect(dialog(page).getByLabel('Password or token', { exact: true })).toBeInViewport();
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();

    await expect(dialog(page)).toHaveCount(0);
    await expect(problem(page)).toContainText('This repository has no credentials.');
    await expect(problem(page).getByRole('button', { name: 'Add credentials' })).toBeFocused();
    expect(gitIn(bare, 'rev-parse', 'main').trim()).toBe(before);
  });
});

test.describe('a locked key', () => {
  let root: string;
  let ssh: GitSshServer;
  /** The server's repositories, which each test adds to. */
  const remotes: Record<string, string> = {};
  let next = 0;

  test.beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'front-burner-web-e2e-ssh-'));
    ssh = await startGitSshServer({ repositories: remotes, authorizedKeys: [ PROTECTED_KEY_PUBLIC ] });
  });

  test.afterAll(async () => {
    await ssh?.close();
    rmSync(root, { recursive: true, force: true });
  });

  const bar = (page: Page) => page.getByRole('banner');
  const banner = (page: Page) => page.locator('rs-locked-key-banner');
  const dialog = (page: Page) => page.getByRole('dialog', { name: 'Unlock laptop' });
  const summary = (page: Page) => bar(page).locator('rs-git-status-summary');
  const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications' });

  /**
   * A repository added over SSH with the passphrase-protected key `laptop`
   * (the key's ID is 1) by another session of the admin: the key is unlocked
   * there, and locked in the browser's. Its working copy has one commit to push.
   */
  async function lockedRepository(instance: { url: string; dataDir: string; }): Promise<{ id: number; bare: string; }> {
    return sshRepository(instance, ssh, remotes, join(root, `locked-${next++}`));
  }

  async function unlock(page: Page, passphrase = PROTECTED_KEY_PASSPHRASE): Promise<void> {
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toContainText('Ed25519');
    await dialog(page).getByLabel('Passphrase').fill(passphrase);
    await dialog(page).getByRole('button', { name: 'Unlock' }).click();
  }

  test('shows the banner below the bar, and unlocking from it removes it', async ({ page, instance }) => {
    const { id } = await lockedRepository(instance);
    await openScreen(page, `/repositories/${id}`);

    await expect(banner(page)).toContainText('laptop is locked. Unlock it to fetch, pull and push.');
    expect((await new AxeBuilder({ page }).include('rs-locked-key-banner').analyze()).violations).toEqual([]);
    await banner(page).getByRole('button', { name: 'Unlock' }).click();
    await expect(dialog(page).getByLabel('Passphrase')).toBeFocused();
    // Contrast is measured once the dialog and its backdrop have faded in.
    await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished)));
    expect((await new AxeBuilder({ page }).include('dlg-unlock-key').analyze()).violations).toEqual([]);
    await unlock(page);

    await expect(dialog(page)).toHaveCount(0);
    await expect(banner(page)).toHaveCount(0);
    await page.reload();
    await expect(summary(page)).toHaveText(/1 to push/);
    await expect(banner(page)).toHaveCount(0);
  });

  test('AC-REPO-002.9: starting a push with a locked key opens the dialog, and after unlocking the push carries on; cancelling cancels it', async ({ page, instance, monitor }) => {
    const { id, bare } = await lockedRepository(instance);
    const before = gitIn(bare, 'rev-parse', 'main').trim();
    await openScreen(page, `/repositories/${id}`);
    await expect(summary(page)).toHaveText(/1 to push/);

    await push(page);
    await expect(dialog(page)).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(bar(page).locator('rs-git-problem')).toHaveCount(0);
    expect(gitIn(bare, 'rev-parse', 'main').trim()).toBe(before);

    await push(page);
    await dialog(page).getByLabel('Passphrase').fill('wrong');
    await dialog(page).getByRole('button', { name: 'Unlock' }).click();
    await expect(dialog(page).getByText('Wrong passphrase')).toBeVisible();
    await unlock(page);

    await expect(toasts(page).getByText('Pushed 1 commit to origin/main')).toBeVisible();
    expect(gitIn(bare, 'log', '-1', '--format=%s', 'main').trim()).toBe('second');
    await expect(banner(page)).toHaveCount(0);
    drainFailedRequests(monitor, `/api/v1/repositories/${id}/git/push`);
    drainFailedRequests(monitor, '/api/v1/credentials/ssh-keys/1/unlock');
  });

  test('AC-REPO-002.15: a key unlocked on one session still shows the banner on another', async ({ page, browser, instance }) => {
    const { id } = await lockedRepository(instance);
    const context = await browser.newContext({ baseURL: instance.url, viewport: { width: 375, height: 700 } });
    const phone = await context.newPage();
    try {
      await openScreen(page, `/repositories/${id}`);
      await openScreen(phone, `/repositories/${id}`);
      await expect(banner(phone)).toBeVisible();

      await banner(page).getByRole('button', { name: 'Unlock' }).click();
      await unlock(page);
      await expect(banner(page)).toHaveCount(0);

      await phone.reload();
      await expect(bar(phone).getByRole('button', { name: 'Git actions' })).toBeVisible();
      await expect(banner(phone)).toContainText('laptop is locked.');
    } finally {
      await context.close();
    }
  });

  test('AC-REPO-002.8: after a restart, a locked key shows the banner and no background fetch runs; unlocking makes fetches resume and removes the banner from every repository that uses the key', async ({ page, context, instance }) => {
    // A second server start, and waiting for a fetch that must not run.
    test.slow();
    const { id, bare } = await lockedRepository(instance);
    const other = await sshRepositoryWithSameKey(instance, ssh, remotes, join(root, `locked-${next++}`));
    await openScreen(page, `/repositories/${id}`);
    await banner(page).getByRole('button', { name: 'Unlock' }).click();
    await unlock(page);
    await expect(banner(page)).toHaveCount(0);

    // Away from the screen while the backend is down, so that nothing it asks for meanwhile fails.
    await page.goto('about:blank');
    await instance.restart();
    // Someone else pushes a commit, which only a fetch can bring.
    const elsewhere = join(dirname(bare), 'elsewhere');
    gitIn(dirname(bare), 'clone', '-q', bare, elsewhere);
    gitIn(elsewhere, 'commit', '-q', '--allow-empty', '-m', 'from elsewhere');
    gitIn(elsewhere, 'push', '-q', 'origin', 'main');
    await page.goto(`/repositories/${id}`);
    const otherPage = await context.newPage();
    await otherPage.goto(`/repositories/${other.id}`);

    await expect(banner(page)).toContainText('laptop is locked.');
    await expect(banner(otherPage)).toContainText('laptop is locked.');
    const details = await fetchStatusDetails(page, KEY_LOCKED);
    await expect(details).toContainText(KEY_LOCKED);
    await expect(details).not.toContainText(FETCH_FAILED);
    await page.keyboard.press('Escape');
    await expect(summary(page)).toHaveText(/1 to push/);
    // Longer than the scheduler's 5 seconds between looks at what is viewed.
    await page.waitForTimeout(7_000);
    await expect(summary(page)).not.toHaveText(/to pull/);

    await banner(page).getByRole('button', { name: 'Unlock' }).click();
    await unlock(page);

    await expect(banner(page)).toHaveCount(0);
    await expect(banner(otherPage)).toHaveCount(0);
    await expectNoFetchProblem(page);
    await expect(summary(page)).toHaveText(/1 to pull/, { timeout: 15_000 });
  });

  test.describe('an unlock that ends by its idle time', () => {
    test.use({ instanceOptions: { onboarded: true, env: { FRONT_BURNER_KEY_UNLOCK_IDLE: '5s' } } });

    test('says so without a reload, and asks for nothing', async ({ page, instance }) => {
      const { id } = await lockedRepository(instance);
      await openScreen(page, `/repositories/${id}`);
      await banner(page).getByRole('button', { name: 'Unlock' }).click();
      await unlock(page);
      await expectNoFetchProblem(page);

      await expect(banner(page)).toContainText('laptop is locked.', { timeout: 15_000 });
      await expect(await fetchStatusDetails(page, KEY_LOCKED)).toContainText(KEY_LOCKED);
      // Not `dialog`, whose name also matches the panel of a phone.
      await expect(page.locator('dlg-unlock-key')).toHaveCount(0);
    });
  });

  test('a dismissed banner leaves Unlock in the bar', async ({ page, instance }) => {
    const { id } = await lockedRepository(instance);
    await openScreen(page, `/repositories/${id}`);
    await banner(page).getByRole('button', { name: 'Dismiss' }).click();
    await expect(banner(page)).toHaveCount(0);

    await (await fetchStatusDetails(page, KEY_LOCKED)).getByRole('button', { name: 'Unlock' }).click();
    await unlock(page);

    await expect(dialog(page)).toHaveCount(0);
    await expectNoFetchProblem(page);
  });

  test('a dismissed banner stays away for the visit, and Push still asks', async ({ page, instance, monitor }) => {
    const { id } = await lockedRepository(instance);
    await openScreen(page, `/repositories/${id}`);
    await banner(page).getByRole('button', { name: 'Dismiss' }).click();
    await expect(banner(page)).toHaveCount(0);

    await push(page);
    await expect(dialog(page)).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(banner(page)).toHaveCount(0);

    await page.reload();
    await expect(banner(page)).toBeVisible();
    drainFailedRequests(monitor, `/api/v1/repositories/${id}/git/push`);
  });
});

test.describe('a changed host key', () => {
  // RC-24's line is logged at `info`.
  test.use({ instanceOptions: { onboarded: true, env: { FRONT_BURNER_LOG_LEVEL: 'info' } } });

  let root: string;
  let ssh: GitSshServer;
  const remotes: Record<string, string> = {};
  let next = 0;

  test.beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'front-burner-web-e2e-host-key-'));
    ssh = await startGitSshServer({ repositories: remotes, authorizedKeys: [ PROTECTED_KEY_PUBLIC ] });
  });

  test.afterAll(async () => {
    await ssh?.close();
    rmSync(root, { recursive: true, force: true });
  });

  const HEADING = 'The server\'s identity has changed. This may be an attack.';
  const bar = (page: Page) => page.getByRole('banner');
  const problem = (page: Page) => bar(page).locator('rs-git-problem');
  const dialog = (page: Page) => page.getByRole('dialog', { name: HEADING });
  const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications' });

  /**
   * An SSH repository whose key is unlocked in the browser, and whose server
   * then replaced its host key; a push has just failed for it, and **Review
   * the new key** opened the dialog.
   */
  async function reviewChangedKey(page: Page, instance: { url: string; dataDir: string; }) {
    const repository = await sshRepository(instance, ssh, remotes, join(root, `changed-${next++}`));
    await openScreen(page, `/repositories/${repository.id}`);
    await page.locator('rs-locked-key-banner').getByRole('button', { name: 'Unlock' }).click();
    const unlock = page.getByRole('dialog', { name: 'Unlock laptop' });
    await unlock.getByLabel('Passphrase').fill(PROTECTED_KEY_PASSPHRASE);
    await unlock.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.locator('rs-locked-key-banner')).toHaveCount(0);
    await ssh.changeHostKey();

    await push(page);
    await expect(problem(page)).toContainText(HEADING);
    await problem(page).getByRole('button', { name: 'Review the new key' }).click();
    await expect(dialog(page)).toBeVisible();
    return repository;
  }

  test('AC-REPO-002.12: a changed host key shows both fingerprints; Trust the new key is disabled until the checkbox is ticked; afterwards the failed operation runs again, and the backend log records the change', async ({ page, instance }) => {
    const { bare } = await reviewChangedKey(page, instance);

    await expect(dialog(page)).toContainText(`127.0.0.1:${ssh.port}`);
    const fingerprints = await dialog(page).locator('code.fingerprint').allTextContents();
    expect(fingerprints).toHaveLength(2);
    expect(fingerprints.every(fingerprint => fingerprint.trim().startsWith('SHA256:'))).toBe(true);
    expect(fingerprints[0]).not.toBe(fingerprints[1]);
    await expect(dialog(page).getByRole('button', { name: 'Cancel' })).toBeFocused();
    const trust = dialog(page).getByRole('button', { name: 'Trust the new key' });
    // `aria-disabled`, which a click passes through and the button swallows (its unit test clicks it).
    await expect(trust).toBeDisabled();
    await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished)));
    expect((await new AxeBuilder({ page }).include('dlg-changed-host-key').analyze()).violations).toEqual([]);

    await dialog(page).getByLabel('I have checked the new fingerprint with the server\'s owner.').check();
    await expect(trust).toBeEnabled();
    await trust.click();

    await expect(dialog(page)).toHaveCount(0);
    await expect(toasts(page).getByText('Pushed 1 commit to origin/main')).toBeVisible();
    expect(gitIn(bare, 'log', '-1', '--format=%s', 'main').trim()).toBe('second');
    await expect(problem(page)).toHaveCount(0);
    await expect.poll(() => instance.output()).toContain(
      `replaced the trusted host key of 127.0.0.1 port ${ssh.port}: ${fingerprints[0]?.trim()} → ${
        fingerprints[1]?.trim()
      }`
    );
  });

  test('a long fingerprint wraps within the dialog at 320 px; Cancel changes nothing, and the push stays failed', async ({ page, instance }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    const { bare } = await reviewChangedKey(page, instance);
    const before = gitIn(bare, 'rev-parse', 'main').trim();

    const box = await dialog(page).boundingBox();
    expect(box).not.toBeNull();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320);
    for (const fingerprint of await dialog(page).locator('code.fingerprint').all()) {
      const code = await fingerprint.boundingBox();
      expect((code?.x ?? 0) + (code?.width ?? 0)).toBeLessThanOrEqual((box?.x ?? 0) + (box?.width ?? 0));
    }

    await dialog(page).getByRole('button', { name: 'Cancel' }).click();

    await expect(dialog(page)).toHaveCount(0);
    await expect(problem(page)).toContainText(HEADING);
    expect(gitIn(bare, 'rev-parse', 'main').trim()).toBe(before);
    expect(instance.output()).not.toContain('replaced the trusted host key');
  });
});

test.describe('the commit author', () => {
  const ADMIN_AUTHOR = `${TEST_ADMIN.displayName} <${TEST_ADMIN.email}>`;
  const question = (page: Page) => page.getByRole('dialog', { name: 'Confirm your commit author' });
  const commitAs = (page: Page, author = ADMIN_AUTHOR) =>
    question(page).getByRole('button', { name: `Commit as ${author}`, exact: true });
  const committingAs = (page: Page, author: string) =>
    changesPane(page).getByText(`Committing as ${author}`, { exact: true });
  const changeDialog = (page: Page) => page.getByRole('dialog', { name: 'Change the commit author' });

  /** One changed file with a message written, ready for **Commit 1 file**. */
  async function readyToCommit(page: Page, url: string, dir: string, text: string): Promise<void> {
    writeFileSync(join(dir, 'README.md'), `# ${text}\n`);
    if (page.url() === 'about:blank') {
      await openScreen(page, url);
    } else {
      await page.goto(url);
    }
    await expect(changesButton(page, 'Changes (1)')).toBeVisible();
    await showChanges(page);
    await message(page).fill(text);
  }

  test('AC-GIT-001.2: the first commit asks, and cancelling makes no commit; the second commit, in any repository, does not ask', async ({ page, instance }) => {
    const first = unconfirmedHandbook(instance);
    const second = unconfirmedHandbook(instance, 'second');
    const before = gitIn(first.dir, 'rev-parse', 'HEAD');
    await readyToCommit(page, `/repositories/${first.id}`, first.dir, 'First commit');

    await commitButton(page, 'Commit 1 file').click();
    await expect(commitAs(page)).toBeVisible();
    await expect(question(page).getByRole('link', { name: 'GitHub\'s help on noreply addresses' })).toBeVisible();
    expect((await new AxeBuilder({ page }).include('dlg-confirm-commit-author').analyze()).violations).toEqual([]);
    await question(page).getByRole('button', { name: 'Cancel' }).click();

    await expect(question(page)).toBeHidden();
    await expect(message(page)).toHaveValue('First commit');
    await expect(commitButton(page, 'Commit 1 file')).toBeFocused();
    expect(gitIn(first.dir, 'rev-parse', 'HEAD')).toBe(before);

    await commitButton(page, 'Commit 1 file').click();
    await commitAs(page).click();
    await expect(message(page)).toHaveValue('');
    expect(gitIn(first.dir, 'log', '-1', '--format=%s %an <%ae>').trim()).toBe(`First commit ${ADMIN_AUTHOR}`);

    await readyToCommit(page, `/repositories/${second.id}`, second.dir, 'Second commit');
    await commitButton(page, 'Commit 1 file').click();
    await expect(message(page)).toHaveValue('');
    await expect(question(page)).toBeHidden();
    expect(gitIn(second.dir, 'log', '-1', '--format=%s').trim()).toBe('Second commit');
  });

  test('AC-GIT-001.6: the form shows Committing as, and Change updates it, as the default or for this repository', async ({ page, instance }) => {
    const { id, dir } = await handbook(instance);
    const other = unconfirmedHandbook(instance, 'other');
    await readyToCommit(page, `/repositories/${id}`, dir, 'For this repository');
    await expect(committingAs(page, ADMIN_AUTHOR)).toBeVisible();

    await changesPane(page).getByRole('button', { name: 'Change commit author' }).click();
    await changeDialog(page).getByRole('textbox', { name: 'Name' }).fill('Ada Work');
    await changeDialog(page).getByRole('textbox', { name: 'Email' }).fill('ada@work.example');
    await changeDialog(page).getByText('For this repository').click();
    expect((await new AxeBuilder({ page }).include('dlg-change-commit-author').analyze()).violations).toEqual([]);
    await changeDialog(page).getByRole('button', { name: 'Save' }).click();

    await expect(committingAs(page, 'Ada Work <ada@work.example>')).toBeVisible();
    await commitButton(page, 'Commit 1 file').click();
    await expect(message(page)).toHaveValue('');
    expect(gitIn(dir, 'log', '-1', '--format=%an <%ae>').trim()).toBe('Ada Work <ada@work.example>');

    await changesPane(page).getByRole('button', { name: 'Change commit author' }).click();
    await expect(changeDialog(page).getByRole('radio', { name: 'For this repository' })).toBeChecked();
    await changeDialog(page).getByText('As my default').click();
    await expect(changeDialog(page).getByText('This repository will stop using its own author')).toBeVisible();
    await changeDialog(page).getByRole('textbox', { name: 'Name' }).fill('Ada Default');
    await changeDialog(page).getByRole('button', { name: 'Save' }).click();

    await expect(committingAs(page, 'Ada Default <ada@work.example>')).toBeVisible();
    await readyToCommit(page, `/repositories/${other.id}`, other.dir, 'Elsewhere');
    await expect(committingAs(page, 'Ada Default <ada@work.example>')).toBeVisible();
  });

  test('AC-GIT-001.10: the API refuses a user who has not confirmed, and the web client asks', async ({ page, instance }) => {
    const { id, dir } = unconfirmedHandbook(instance);
    writeFileSync(join(dir, 'README.md'), '# Changed\n');

    const answer = await fetch(`${instance.url}/api/v1/repositories/${id}/git/commits`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await adminAuthToken(instance.url)}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ message: 'Refused', paths: [ 'README.md' ] })
    });
    expect(answer.status).toBe(409);
    expect((await answer.json() as { code: string; }).code).toBe('commit-author-not-confirmed');

    await readyToCommit(page, `/repositories/${id}`, dir, 'Asked');
    await commitButton(page, 'Commit 1 file').click();
    await commitAs(page).click();

    await expect(message(page)).toHaveValue('');
    expect(gitIn(dir, 'log', '-1', '--format=%s').trim()).toBe('Asked');
  });

  test('AC-GIT-001.12: editing the default before the first commit means the first commit does not ask', async ({ page, instance }) => {
    const { id, dir } = unconfirmedHandbook(instance);
    await page.goto('/preferences');
    await logIn(page);
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('textbox', { name: 'Name' }).fill('Ada Edited');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();

    await readyToCommit(page, `/repositories/${id}`, dir, 'Not asked');
    await commitButton(page, 'Commit 1 file').click();

    await expect(message(page)).toHaveValue('');
    await expect(question(page)).toBeHidden();
    expect(gitIn(dir, 'log', '-1', '--format=%an').trim()).toBe('Ada Edited');
  });

  test('a default changed in another tab shows here at once', async ({ page, context, instance }) => {
    const { id, dir } = await handbook(instance);
    await readyToCommit(page, `/repositories/${id}`, dir, 'Other tab');
    await expect(committingAs(page, ADMIN_AUTHOR)).toBeVisible();

    const other = await context.newPage();
    await other.goto('/preferences');
    await other.getByRole('button', { name: 'Edit' }).click();
    await other.getByRole('textbox', { name: 'Name' }).fill('Ada Elsewhere');
    await other.getByRole('button', { name: 'Save' }).click();
    await expect(other.getByRole('button', { name: 'Edit' })).toBeVisible();
    await other.close();

    await expect(committingAs(page, `Ada Elsewhere <${TEST_ADMIN.email}>`)).toBeVisible();
  });

  test('warns when the author can\'t be read, and Try again brings the line back', async ({ page, instance, monitor }) => {
    const { id, dir } = await handbook(instance);
    let refuse = true;
    await page.route(
      `**/api/v1/repositories/${id}/commit-author`,
      route =>
        refuse
          ? route.fulfill({ status: 500, json: { code: 'internal', params: {}, requestId: 'r', message: 'x' } })
          : route.continue()
    );
    await readyToCommit(page, `/repositories/${id}`, dir, 'Warned');

    await expect(changesPane(page).getByText('Couldn\'t read your commit author.')).toBeVisible();
    await expect(changesPane(page).getByText(/^Committing as/)).toBeHidden();

    refuse = false;
    await changesPane(page).getByRole('button', { name: 'Try again', exact: true }).click();

    await expect(committingAs(page, ADMIN_AUTHOR)).toBeVisible();
    await expect(changesPane(page).getByText('Couldn\'t read your commit author.')).toBeHidden();
    drainFailedRequests(monitor, `/api/v1/repositories/${id}/commit-author`);
  });

  test('a very long name and email wrap and stay readable at 320 px', async ({ page, instance }) => {
    const { id, dir } = unconfirmedHandbook(instance);
    const name = 'Ada'.repeat(60);
    const email = `${'a'.repeat(120)}@${'b'.repeat(120)}`;
    await page.setViewportSize({ width: 320, height: 640 });
    await readyToCommit(page, `/repositories/${id}`, dir, 'Long');

    await changesPane(page).getByRole('button', { name: 'Change commit author' }).click();
    await changeDialog(page).getByRole('textbox', { name: 'Name' }).fill(name);
    await changeDialog(page).getByRole('textbox', { name: 'Email' }).fill(email);
    await changeDialog(page).getByText('For this repository').click();
    await changeDialog(page).getByRole('button', { name: 'Save' }).click();

    const line = committingAs(page, `${name} <${email}>`);
    await expect(line).toBeVisible();
    const fits = (element: HTMLElement | SVGElement) => element.scrollWidth <= element.clientWidth + 1;
    expect(await line.evaluate(fits)).toBe(true);
    expect((await line.boundingBox())?.width).toBeLessThanOrEqual(320);

    await commitButton(page, 'Commit 1 file').click();
    const button = commitAs(page, `${name} <${email}>`);
    await expect(button).toBeVisible();
    expect(await button.evaluate(fits)).toBe(true);
    const box = await button.boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320);
    const summary = question(page).locator('dlg-commit-author-summary');
    await expect(summary).toContainText(email);
    expect((await summary.boundingBox())?.width ?? Infinity).toBeLessThanOrEqual(320);
    expect(await summary.evaluate(fits)).toBe(true);
  });
});
